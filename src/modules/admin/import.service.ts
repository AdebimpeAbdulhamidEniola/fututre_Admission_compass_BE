/**
 * Excel import of one university's rules (and, optionally, its course cut-offs).
 *
 * Sheet layout (one sheet):
 *   1. University block — column A = field name, column B = value (see UNIVERSITY_FIELDS).
 *   2. A header row whose first cell is "name", then one row per course (see COURSE_COLUMNS).
 *
 * previewImport() parses, validates and diffs against the database without writing anything;
 * applyImport() does the same and then writes everything in one transaction. Courses at the
 * university that aren't in the file are left untouched — an import never deletes.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { badRequest } from "../../lib/errors.js";
import { toNumberMap } from "../../lib/prisma-json.js";
import { asSittingBonus } from "../assessment/engine.js";
import { logAdminAction } from "./admin.service.js";
import type {
  Cell,
  CoursePreview,
  FieldChange,
  ImportIssue,
  ImportPreview,
} from "./import.schemas.js";

const GRADES = ["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"];

type FieldKind = "text" | "number" | "list" | "gradePoints";
const UNIVERSITY_FIELDS: Record<string, { kind: FieldKind; required: boolean }> = {
  code: { kind: "text", required: true },
  name: { kind: "text", required: true },
  locationState: { kind: "text", required: true },
  utmeWeighting: { kind: "number", required: true },
  postUtmeWeighting: { kind: "number", required: true },
  oLevelWeighting: { kind: "number", required: true },
  utmeMaxScore: { kind: "number", required: true },
  postUtmeMaxScore: { kind: "number", required: true },
  minPostUtmePercent: { kind: "number", required: false },
  twoSittingDeductionPoints: { kind: "number", required: false },
  sittingBonusOneSitting: { kind: "number", required: false },
  sittingBonusTwoSittings: { kind: "number", required: false },
  gradePoints: { kind: "gradePoints", required: false },
  catchmentStates: { kind: "list", required: true },
  eldsStates: { kind: "list", required: false },
  meritQuota: { kind: "number", required: true },
  catchmentQuota: { kind: "number", required: true },
  eldsQuota: { kind: "number", required: true },
};

const COURSE_COLUMNS = [
  "name",
  "faculty",
  "requiredUtmeSubjects",
  "optionalUtmeSubjects",
  "utmeSubjectGroups",
  "requiredOLevelSubjects",
  "minimumCredits",
  "oLevelSubstitutions",
  "meritCutOff",
  "catchmentCutOff",
  "eldsCutOff",
  "utmeCutOff",
  "catchmentByState",
  "eldsByState",
] as const;
type CourseColumn = (typeof COURSE_COLUMNS)[number];
const REQUIRED_COURSE_COLUMNS: CourseColumn[] = [
  "name",
  "faculty",
  "requiredOLevelSubjects",
  "minimumCredits",
];
/** Extra columns an admin may add for their own notes — ignored. */
const IGNORED_COLUMNS = new Set(["notes", "note", "comment", "comments"]);

interface ParsedUniversity {
  code: string;
  name: string;
  locationState: string;
  policy: {
    utmeWeighting: number;
    postUtmeWeighting: number;
    oLevelWeighting: number;
    utmeMaxScore: number;
    postUtmeMaxScore: number;
    minPostUtmePercent: number | null;
    twoSittingDeductionPoints: number | null;
    sittingBonus: { oneSitting: number; twoSittings: number } | null;
    oLevelGradePoints: Record<string, number> | null;
  };
  catchment: {
    catchmentStates: string[];
    eldsStates: string[];
    meritQuotaPercent: number;
    catchmentQuotaPercent: number;
    eldsQuotaPercent: number;
  };
}

interface OLevelSubstitution {
  subject: string;
  alternatives: string[];
  countsTowardPoints: boolean;
}

/** Cut-off values: undefined = blank cell (keep current), null = "none" (clear). */
interface ParsedCutOffs {
  meritCutOff?: number | null;
  catchmentCutOff?: number | null;
  eldsCutOff?: number | null;
  utmeCutOff?: number | null;
  catchmentCutOffByState?: Record<string, number> | null;
  eldsCutOffByState?: Record<string, number> | null;
}

interface ParsedCourse {
  row: number;
  name: string;
  faculty: string;
  requirement: {
    requiredUtmeSubjects: string[];
    optionalUtmeSubjects: string[];
    utmeSubjectGroups: string[][];
    requiredOLevelSubjects: string[];
    minimumCredits: number;
    oLevelSubstitutions: OLevelSubstitution[];
  };
  cutOffs: ParsedCutOffs;
}

// --- Cell helpers ------------------------------------------------------------------------------

function text(cell: Cell | undefined): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const splitList = (value: string) =>
  value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

/** Stable JSON for comparing values regardless of object key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

// --- Parsing + validation ----------------------------------------------------------------------

class IssueCollector {
  issues: ImportIssue[] = [];
  add(row: number, column: string, message: string) {
    this.issues.push({ row, column, message });
  }
}

function parseNumber(
  raw: string,
  row: number,
  column: string,
  issues: IssueCollector,
): number | undefined {
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) {
    issues.add(row, column, `"${raw}" is not a number.`);
    return undefined;
  }
  return n;
}

/** "Lagos=73.2;Ogun=71" → { Lagos: 73.2, Ogun: 71 } */
function parseStateMap(raw: string, row: number, column: string, issues: IssueCollector) {
  const map: Record<string, number> = {};
  for (const part of splitList(raw)) {
    const [state, value] = part.split("=").map((s) => s.trim());
    const n = Number(value);
    if (!state || value === undefined || !Number.isFinite(n) || n < 0 || n > 100) {
      issues.add(row, column, `"${part}" should look like State=cut-off (0–100), e.g. Lagos=73.2.`);
      continue;
    }
    map[state] = n;
  }
  return map;
}

function parseUniversity(
  rows: Cell[][],
  headerIndex: number,
  issues: IssueCollector,
): ParsedUniversity | null {
  const raw: Record<string, { value: string; row: number }> = {};
  const fieldByLower = new Map(Object.keys(UNIVERSITY_FIELDS).map((f) => [f.toLowerCase(), f]));

  for (let i = 0; i < headerIndex; i++) {
    const key = text(rows[i]?.[0]);
    if (!key) continue;
    const field = fieldByLower.get(key.toLowerCase());
    if (!field) {
      issues.add(i + 1, "A", `Unknown university field "${key}".`);
      continue;
    }
    raw[field] = { value: text(rows[i]?.[1]), row: i + 1 };
  }

  const num: Record<string, number | null> = {};
  for (const [field, spec] of Object.entries(UNIVERSITY_FIELDS)) {
    const entry = raw[field];
    if (!entry || entry.value === "") {
      if (spec.required)
        issues.add(entry?.row ?? 1, entry ? "B" : "A", `University field "${field}" is required.`);
      if (spec.kind === "number") num[field] = null;
      continue;
    }
    if (spec.kind === "number")
      num[field] = parseNumber(entry.value, entry.row, "B", issues) ?? null;
  }

  const rowOf = (field: string) => raw[field]?.row ?? 1;
  const inRange = (field: string, min: number, max: number) => {
    const v = num[field];
    if (v !== null && v !== undefined && (v < min || v > max)) {
      issues.add(rowOf(field), "B", `${field} must be between ${min} and ${max}.`);
    }
  };
  ["utmeWeighting", "postUtmeWeighting", "oLevelWeighting", "minPostUtmePercent"].forEach((f) =>
    inRange(f, 0, 100),
  );
  [
    "meritQuota",
    "catchmentQuota",
    "eldsQuota",
    "sittingBonusOneSitting",
    "sittingBonusTwoSittings",
  ].forEach((f) => inRange(f, 0, 100));
  ["utmeMaxScore", "postUtmeMaxScore"].forEach((f) => {
    const v = num[f];
    if (v !== null && v !== undefined && v <= 0)
      issues.add(rowOf(f), "B", `${f} must be greater than 0.`);
  });
  if (num.twoSittingDeductionPoints !== null && num.twoSittingDeductionPoints < 0) {
    issues.add(
      rowOf("twoSittingDeductionPoints"),
      "B",
      "twoSittingDeductionPoints can't be negative.",
    );
  }

  const one = num.sittingBonusOneSitting;
  const two = num.sittingBonusTwoSittings;
  if ((one === null) !== (two === null)) {
    issues.add(
      rowOf(one === null ? "sittingBonusOneSitting" : "sittingBonusTwoSittings"),
      "B",
      "Fill in both sittingBonusOneSitting and sittingBonusTwoSittings, or neither.",
    );
  }
  const sittingBonus = one !== null && two !== null ? { oneSitting: one, twoSittings: two } : null;

  const weights = [num.utmeWeighting, num.postUtmeWeighting, num.oLevelWeighting];
  if (weights.every((w) => w !== null)) {
    const total =
      (weights as number[]).reduce((s, w) => s + w, 0) + (sittingBonus?.oneSitting ?? 0);
    if (Math.abs(total - 100) > 0.01) {
      issues.add(
        rowOf("utmeWeighting"),
        "B",
        `UTME + Post-UTME + O'Level weightings${sittingBonus ? " + sitting bonus" : ""} must add up to 100; they add up to ${Math.round(total * 100) / 100}.`,
      );
    }
  }
  const quotas = [num.meritQuota, num.catchmentQuota, num.eldsQuota];
  if (quotas.every((q) => q !== null)) {
    const total = (quotas as number[]).reduce((s, q) => s + q, 0);
    if (Math.abs(total - 100) > 0.01) {
      issues.add(
        rowOf("meritQuota"),
        "B",
        `meritQuota + catchmentQuota + eldsQuota must add up to 100; they add up to ${total}.`,
      );
    }
  }

  let oLevelGradePoints: Record<string, number> | null = null;
  if (raw.gradePoints?.value) {
    oLevelGradePoints = {};
    for (const part of splitList(raw.gradePoints.value)) {
      const [grade, value] = part.split("=").map((s) => s.trim().toUpperCase());
      const n = Number(value);
      if (!GRADES.includes(grade) || value === undefined || !Number.isFinite(n) || n < 0) {
        issues.add(raw.gradePoints.row, "B", `"${part}" should look like A1=6 (grades A1–F9).`);
        continue;
      }
      oLevelGradePoints[grade] = n;
    }
  }

  if (issues.issues.length > 0) return null;
  return {
    code: raw.code.value.toUpperCase(),
    name: raw.name.value,
    locationState: raw.locationState.value,
    policy: {
      utmeWeighting: num.utmeWeighting!,
      postUtmeWeighting: num.postUtmeWeighting!,
      oLevelWeighting: num.oLevelWeighting!,
      utmeMaxScore: num.utmeMaxScore!,
      postUtmeMaxScore: num.postUtmeMaxScore!,
      minPostUtmePercent: num.minPostUtmePercent,
      twoSittingDeductionPoints: num.twoSittingDeductionPoints,
      sittingBonus,
      oLevelGradePoints,
    },
    catchment: {
      catchmentStates: splitList(raw.catchmentStates.value),
      eldsStates: splitList(raw.eldsStates?.value ?? ""),
      meritQuotaPercent: num.meritQuota!,
      catchmentQuotaPercent: num.catchmentQuota!,
      eldsQuotaPercent: num.eldsQuota!,
    },
  };
}

function parseCourses(rows: Cell[][], headerIndex: number, issues: IssueCollector): ParsedCourse[] {
  const header = rows[headerIndex] ?? [];
  const headerRow = headerIndex + 1;
  const columnByLower = new Map(COURSE_COLUMNS.map((c) => [c.toLowerCase(), c]));
  const indexOf: Partial<Record<CourseColumn, number>> = {};

  header.forEach((cell, i) => {
    const label = text(cell);
    if (!label) return;
    const column = columnByLower.get(label.toLowerCase());
    if (column) indexOf[column] = i;
    else if (!IGNORED_COLUMNS.has(label.toLowerCase())) {
      issues.add(headerRow, columnLetter(i), `Unknown course column "${label}".`);
    }
  });
  for (const column of REQUIRED_COURSE_COLUMNS) {
    if (indexOf[column] === undefined)
      issues.add(headerRow, "-", `The course table needs a "${column}" column.`);
  }
  if (REQUIRED_COURSE_COLUMNS.some((c) => indexOf[c] === undefined)) return [];

  const courses: ParsedCourse[] = [];
  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.every((c) => text(c) === "")) continue;
    const row = i + 1;
    const get = (column: CourseColumn) =>
      indexOf[column] === undefined ? "" : text(cells[indexOf[column]!]);
    const col = (column: CourseColumn) =>
      indexOf[column] === undefined ? "-" : columnLetter(indexOf[column]!);
    const before = issues.issues.length;

    const name = get("name");
    const faculty = get("faculty");
    if (!name) issues.add(row, col("name"), "Course name is required.");
    if (!faculty) issues.add(row, col("faculty"), "Faculty is required.");
    const duplicateOf = seen.get(name.toLowerCase());
    if (name && duplicateOf)
      issues.add(row, col("name"), `"${name}" is already listed on row ${duplicateOf}.`);
    if (name) seen.set(name.toLowerCase(), row);

    const requiredUtmeSubjects = splitList(get("requiredUtmeSubjects"));
    const optionalUtmeSubjects = splitList(get("optionalUtmeSubjects"));
    const utmeSubjectGroups = splitList(get("utmeSubjectGroups"))
      .map((group) =>
        group
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .filter((g) => g.length > 0);
    if (
      requiredUtmeSubjects.length + optionalUtmeSubjects.length + utmeSubjectGroups.length ===
      0
    ) {
      issues.add(
        row,
        col("requiredUtmeSubjects"),
        "List the UTME subjects (required, optional or groups).",
      );
    }
    const subjectCount = requiredUtmeSubjects.length + utmeSubjectGroups.length;
    if (subjectCount > 3) {
      issues.add(
        row,
        col("requiredUtmeSubjects"),
        "Required UTME subjects plus groups can't exceed 3.",
      );
    }

    const requiredOLevelSubjects = splitList(get("requiredOLevelSubjects"));
    if (requiredOLevelSubjects.length === 0) {
      issues.add(row, col("requiredOLevelSubjects"), "List at least one required O'Level subject.");
    }

    const creditsRaw = get("minimumCredits");
    const minimumCredits = creditsRaw === "" ? 5 : Number(creditsRaw);
    if (!Number.isInteger(minimumCredits) || minimumCredits < 0 || minimumCredits > 9) {
      issues.add(row, col("minimumCredits"), "minimumCredits must be a whole number from 0 to 9.");
    }

    const oLevelSubstitutions: OLevelSubstitution[] = [];
    for (const part of splitList(get("oLevelSubstitutions"))) {
      const [rule, flag] = part.split(":").map((s) => s.trim());
      const [subject, alternatives] = (rule ?? "").split("=").map((s) => s.trim());
      const alts = (alternatives ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!subject || alts.length === 0 || (flag && flag.toLowerCase() !== "nopoints")) {
        issues.add(
          row,
          col("oLevelSubstitutions"),
          `"${part}" should look like Biology=Agricultural Science (add :nopoints if it scores zero).`,
        );
        continue;
      }
      oLevelSubstitutions.push({
        subject,
        alternatives: alts,
        countsTowardPoints: flag?.toLowerCase() !== "nopoints",
      });
    }

    const cutOffs: ParsedCutOffs = {};
    const scoreCutOff = (
      column: CourseColumn,
      key: "meritCutOff" | "catchmentCutOff" | "eldsCutOff" | "utmeCutOff",
      max: number,
    ) => {
      const raw = get(column);
      if (raw === "") return;
      if (raw.toLowerCase() === "none") {
        cutOffs[key] = null;
        return;
      }
      const n = parseNumber(raw, row, col(column), issues);
      if (n === undefined) return;
      if (n < 0 || n > max) issues.add(row, col(column), `${column} must be between 0 and ${max}.`);
      else cutOffs[key] = key === "utmeCutOff" ? Math.round(n) : n;
    };
    scoreCutOff("meritCutOff", "meritCutOff", 100);
    scoreCutOff("catchmentCutOff", "catchmentCutOff", 100);
    scoreCutOff("eldsCutOff", "eldsCutOff", 100);
    scoreCutOff("utmeCutOff", "utmeCutOff", 400);
    for (const [column, key] of [
      ["catchmentByState", "catchmentCutOffByState"],
      ["eldsByState", "eldsCutOffByState"],
    ] as const) {
      const raw = get(column);
      if (raw === "") continue;
      cutOffs[key] =
        raw.toLowerCase() === "none" ? null : parseStateMap(raw, row, col(column), issues);
    }

    if (issues.issues.length === before) {
      courses.push({
        row,
        name,
        faculty,
        requirement: {
          requiredUtmeSubjects,
          optionalUtmeSubjects,
          utmeSubjectGroups,
          requiredOLevelSubjects,
          minimumCredits,
          oLevelSubstitutions,
        },
        cutOffs,
      });
    }
  }

  if (courses.length === 0 && issues.issues.length === 0) {
    issues.add(headerRow + 1, "A", "The course table has no courses.");
  }
  return courses;
}

function parseSheet(rows: Cell[][]) {
  const issues = new IssueCollector();
  const headerIndex = rows.findIndex(
    (r) => text(r?.[0]).toLowerCase() === "name" && text(r?.[1]).toLowerCase() === "faculty",
  );
  if (headerIndex === -1) {
    issues.add(
      1,
      "A",
      'Couldn\'t find the course table: add a header row starting with "name" and "faculty".',
    );
    return { university: null, courses: [], issues: issues.issues };
  }
  const universityIssues = new IssueCollector();
  const university = parseUniversity(rows, headerIndex, universityIssues);
  const courses = parseCourses(rows, headerIndex, issues);
  return { university, courses, issues: [...universityIssues.issues, ...issues.issues] };
}

// --- Diff against the database -----------------------------------------------------------------

async function loadExisting(code: string) {
  return prisma.university.findUnique({
    where: { code },
    include: {
      scoringPolicy: true,
      catchmentRule: true,
      courses: { include: { requirement: true } },
    },
  });
}
type Existing = NonNullable<Awaited<ReturnType<typeof loadExisting>>>;

function diff(fields: Record<string, [unknown, unknown]>): FieldChange[] {
  return Object.entries(fields)
    .filter(([, [from, to]]) => stable(from ?? null) !== stable(to ?? null))
    .map(([field, [from, to]]) => ({ field, from: from ?? null, to: to ?? null }));
}

function universityChanges(u: ParsedUniversity, existing: Existing | null): FieldChange[] {
  const p = existing?.scoringPolicy;
  const r = existing?.catchmentRule;
  return diff({
    name: [existing?.name, u.name],
    locationState: [existing?.locationState, u.locationState],
    utmeWeighting: [p?.utmeWeighting, u.policy.utmeWeighting],
    postUtmeWeighting: [p?.postUtmeWeighting, u.policy.postUtmeWeighting],
    oLevelWeighting: [p?.oLevelWeighting, u.policy.oLevelWeighting],
    utmeMaxScore: [p?.utmeMaxScore, u.policy.utmeMaxScore],
    postUtmeMaxScore: [p?.postUtmeMaxScore, u.policy.postUtmeMaxScore],
    minPostUtmePercent: [p?.minPostUtmePercent, u.policy.minPostUtmePercent],
    twoSittingDeductionPoints: [p?.twoSittingDeductionPoints, u.policy.twoSittingDeductionPoints],
    sittingBonus: [p ? asSittingBonus(p.sittingBonus) : null, u.policy.sittingBonus],
    gradePoints: [
      p ? (toNumberMap(p.oLevelGradePoints) ?? null) : null,
      u.policy.oLevelGradePoints,
    ],
    catchmentStates: [r?.catchmentStates, u.catchment.catchmentStates],
    eldsStates: [r?.eldsStates, u.catchment.eldsStates],
    meritQuota: [r?.meritQuotaPercent, u.catchment.meritQuotaPercent],
    catchmentQuota: [r?.catchmentQuotaPercent, u.catchment.catchmentQuotaPercent],
    eldsQuota: [r?.eldsQuotaPercent, u.catchment.eldsQuotaPercent],
  });
}

function courseChanges(
  c: ParsedCourse,
  existing: Existing["courses"][number] | undefined,
): FieldChange[] {
  const req = existing?.requirement;
  const fields: Record<string, [unknown, unknown]> = {
    faculty: [existing?.faculty, c.faculty],
    requiredUtmeSubjects: [req?.requiredUtmeSubjects, c.requirement.requiredUtmeSubjects],
    optionalUtmeSubjects: [req?.optionalUtmeSubjects, c.requirement.optionalUtmeSubjects],
    utmeSubjectGroups: [req?.utmeSubjectGroups ?? [], c.requirement.utmeSubjectGroups],
    requiredOLevelSubjects: [req?.requiredOLevelSubjects, c.requirement.requiredOLevelSubjects],
    minimumCredits: [req?.minimumCredits, c.requirement.minimumCredits],
    oLevelSubstitutions: [req?.oLevelSubstitutions ?? [], c.requirement.oLevelSubstitutions],
  };
  const current: Record<keyof ParsedCutOffs, unknown> = {
    meritCutOff: existing?.meritCutOff,
    catchmentCutOff: existing?.catchmentCutOff,
    eldsCutOff: existing?.eldsCutOff,
    utmeCutOff: existing?.utmeCutOff,
    catchmentCutOffByState: existing
      ? (toNumberMap(existing.catchmentCutOffByState) ?? null)
      : null,
    eldsCutOffByState: existing ? (toNumberMap(existing.eldsCutOffByState) ?? null) : null,
  };
  for (const key of Object.keys(c.cutOffs) as (keyof ParsedCutOffs)[]) {
    fields[key] = [current[key], c.cutOffs[key]];
  }
  return diff(fields);
}

async function buildPreview(rows: Cell[][]) {
  const { university, courses, issues } = parseSheet(rows);
  const empty: ImportPreview = {
    valid: false,
    errors: issues,
    universityCode: university?.code ?? null,
    universityAction: null,
    universityChanges: [],
    courses: [],
    untouchedCourses: [],
  };
  if (!university || issues.length > 0)
    return { preview: empty, university, courses, existing: null };

  const existing = await loadExisting(university.code);
  const existingByName = new Map((existing?.courses ?? []).map((c) => [c.name.toLowerCase(), c]));
  const coursePreviews: CoursePreview[] = courses.map((c) => {
    const current = existingByName.get(c.name.toLowerCase());
    const changes = courseChanges(c, current);
    return {
      row: c.row,
      name: c.name,
      action: !current ? "create" : changes.length > 0 ? "update" : "unchanged",
      changes,
    };
  });
  const inFile = new Set(courses.map((c) => c.name.toLowerCase()));
  const uniChanges = universityChanges(university, existing);

  const preview: ImportPreview = {
    valid: true,
    errors: [],
    universityCode: university.code,
    universityAction: !existing ? "create" : uniChanges.length > 0 ? "update" : "unchanged",
    universityChanges: uniChanges,
    courses: coursePreviews,
    untouchedCourses: (existing?.courses ?? [])
      .filter((c) => !inFile.has(c.name.toLowerCase()))
      .map((c) => c.name),
  };
  return { preview, university, courses, existing };
}

export async function previewImport(rows: Cell[][]): Promise<ImportPreview> {
  return (await buildPreview(rows)).preview;
}

// --- Apply -------------------------------------------------------------------------------------

const jsonOrDbNull = (value: object | null) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

export async function applyImport(actorId: string, rows: Cell[][]) {
  const { preview, university, courses, existing } = await buildPreview(rows);
  if (!preview.valid || !university) {
    throw badRequest(preview.errors.map((e) => `Row ${e.row}, column ${e.column}: ${e.message}`));
  }
  const existingByName = new Map((existing?.courses ?? []).map((c) => [c.name.toLowerCase(), c]));

  await prisma.$transaction(
    async (tx) => {
      const uni = await tx.university.upsert({
        where: { code: university.code },
        update: { name: university.name, locationState: university.locationState },
        create: {
          code: university.code,
          name: university.name,
          locationState: university.locationState,
        },
      });

      const policy = {
        ...university.policy,
        sittingBonus: jsonOrDbNull(university.policy.sittingBonus),
        oLevelGradePoints: jsonOrDbNull(university.policy.oLevelGradePoints),
      };
      await tx.scoringPolicy.upsert({
        where: { universityId: uni.id },
        update: policy,
        create: { universityId: uni.id, ...policy },
      });
      await tx.catchmentRule.upsert({
        where: { universityId: uni.id },
        update: university.catchment,
        create: { universityId: uni.id, ...university.catchment },
      });

      for (const course of courses) {
        const current = existingByName.get(course.name.toLowerCase());
        const { catchmentCutOffByState, eldsCutOffByState, ...scores } = course.cutOffs;
        const cutOffData = {
          ...scores,
          ...(catchmentCutOffByState !== undefined
            ? { catchmentCutOffByState: jsonOrDbNull(catchmentCutOffByState) }
            : {}),
          ...(eldsCutOffByState !== undefined
            ? { eldsCutOffByState: jsonOrDbNull(eldsCutOffByState) }
            : {}),
        };
        const row = current
          ? await tx.course.update({
              where: { id: current.id },
              data: { faculty: course.faculty, ...cutOffData },
            })
          : await tx.course.create({
              data: {
                universityId: uni.id,
                name: course.name,
                faculty: course.faculty,
                ...cutOffData,
              },
            });

        const requirement = {
          ...course.requirement,
          utmeSubjectGroups: course.requirement.utmeSubjectGroups as Prisma.InputJsonValue,
          oLevelSubstitutions: course.requirement
            .oLevelSubstitutions as unknown as Prisma.InputJsonValue,
        };
        await tx.admissionRequirement.upsert({
          where: { courseId: row.id },
          update: requirement,
          create: { courseId: row.id, ...requirement },
        });
      }
    },
    // Neon and other remote databases can be slow for a few hundred upserts.
    { timeout: 120_000, maxWait: 20_000 },
  );

  const counts = {
    created: preview.courses.filter((c) => c.action === "create").length,
    updated: preview.courses.filter((c) => c.action === "update").length,
    unchanged: preview.courses.filter((c) => c.action === "unchanged").length,
  };
  await logAdminAction(
    actorId,
    "IMPORT",
    "University",
    `Imported ${university.code} from Excel: ${counts.created} course(s) created, ${counts.updated} updated, ${counts.unchanged} unchanged${preview.universityAction === "create" ? " (new university)" : ""}`,
  );

  return { universityCode: university.code, universityAction: preview.universityAction, ...counts };
}
