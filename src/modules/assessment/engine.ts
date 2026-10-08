/**
 * Ports src/mocks/engine.ts from the frontend repo — the reference implementation for
 * eligibility, scoring, catchment classification, and recommendations — onto real Postgres
 * data via Prisma instead of in-memory mock arrays. Keep this logic in lockstep with the
 * frontend's engine.ts; it's the single source of truth for the business rules.
 */
import type { CatchmentRule, Course, OLevelGrade, ScoringPolicy } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { ApiError, badRequest } from "../../lib/errors.js";
import type { CandidateProfileInput } from "./candidate-profile.schema.js";

// Generic fallback table. Only used when a university's ScoringPolicy.oLevelGradePoints is null.
const GENERIC_GRADE_POINTS: Record<OLevelGrade, number> = {
  A1: 10,
  B2: 9,
  B3: 8,
  C4: 7,
  C5: 6,
  C6: 5,
  D7: 0,
  E8: 0,
  F9: 0,
};

const CREDIT_GRADES: OLevelGrade[] = ["A1", "B2", "B3", "C4", "C5", "C6"];

/**
 * A university's O'Level grade table isn't always the generic one — FUNAAB's confirmed formula
 * (helpdesk.funaab.edu.ng, Article ID 30) uses A1=6..C6=1 (max 30), not the generic A1=10..C6=5
 * (max 50). Normalizing by each table's own max (best possible score across 5 subjects) keeps
 * the resulting percentage correct regardless of which table is in play.
 */
function resolveGradePointsTable(policy: ScoringPolicy): Record<OLevelGrade, number> {
  const raw = policy.oLevelGradePoints as Record<string, number> | null;
  if (!raw) return GENERIC_GRADE_POINTS;
  return { ...GENERIC_GRADE_POINTS, ...raw } as Record<OLevelGrade, number>;
}

const GRADE_ORDER: OLevelGrade[] = ["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"];

type OLevelResultInput = CandidateProfileInput["oLevelResults"][number];

interface RequirementRules {
  requiredUtmeSubjects: string[];
  optionalUtmeSubjects: string[];
  requiredOLevelSubjects: string[];
  minimumCredits: number;
  oLevelSubstitutions: unknown;
}

export interface OLevelSubstitution {
  subject: string;
  alternatives: string[];
  countsTowardPoints: boolean;
}

/** Prisma's Json comes back untyped — keep only well-formed substitution entries. */
function asSubstitutions(value: unknown): OLevelSubstitution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { subject, alternatives, countsTowardPoints } = entry as Record<string, unknown>;
    if (typeof subject !== "string" || !Array.isArray(alternatives)) return [];
    return [
      {
        subject,
        alternatives: alternatives.filter((a): a is string => typeof a === "string"),
        countsTowardPoints: countsTowardPoints === true,
      },
    ];
  });
}

/**
 * One result per subject (keyed case-insensitively), keeping the best grade. A candidate who
 * combines two sittings lists the same subject twice; only the better grade counts.
 */
function bestResultsBySubject(results: OLevelResultInput[]): Map<string, OLevelResultInput> {
  const best = new Map<string, OLevelResultInput>();
  for (const result of results) {
    const key = result.subject.toLowerCase();
    const existing = best.get(key);
    if (!existing || GRADE_ORDER.indexOf(result.grade) < GRADE_ORDER.indexOf(existing.grade)) {
      best.set(key, result);
    }
  }
  return best;
}

function checkUtmeSubjects(utmeSubjects: string[], requirement: RequirementRules) {
  const subjects = utmeSubjects.filter((s) => s !== "Use of English");
  const allowed = [...requirement.requiredUtmeSubjects, ...requirement.optionalUtmeSubjects];
  const missing = requirement.requiredUtmeSubjects.filter((s) => !subjects.includes(s));
  const invalid = subjects.filter((s) => !allowed.includes(s));
  return { passed: missing.length === 0, missing, invalid };
}

interface UsedSubstitution {
  subject: string;
  usedSubject: string;
  countsTowardPoints: boolean;
}

/**
 * Every required O'Level subject needs a credit (C6 or better) — either in the subject itself or
 * in one of the alternatives the course accepts in its place (AdmissionRequirement.oLevelSubstitutions).
 */
function checkOLevelCredits(results: OLevelResultInput[], requirement: RequirementRules) {
  const best = bestResultsBySubject(results);
  const hasCredit = (subject: string) => {
    const result = best.get(subject.toLowerCase());
    return result !== undefined && CREDIT_GRADES.includes(result.grade);
  };
  const substitutionRules = asSubstitutions(requirement.oLevelSubstitutions);

  const missingCredits: string[] = [];
  const substitutions: UsedSubstitution[] = [];
  for (const subject of requirement.requiredOLevelSubjects) {
    if (hasCredit(subject)) continue;
    const rule = substitutionRules.find((r) => r.subject.toLowerCase() === subject.toLowerCase());
    const usedSubject = rule?.alternatives.find(hasCredit);
    if (rule && usedSubject) {
      substitutions.push({ subject, usedSubject, countsTowardPoints: rule.countsTowardPoints });
    } else {
      missingCredits.push(subject);
    }
  }

  const creditCount = [...best.values()].filter((r) => CREDIT_GRADES.includes(r.grade)).length;
  return {
    passed: missingCredits.length === 0 && creditCount >= requirement.minimumCredits,
    missingCredits,
    creditCount,
    substitutions,
  };
}

const SCORED_OLEVEL_SUBJECTS = 5;

/**
 * O'Level points over exactly 5 subjects. Per the dossier (UNILAG and FUNAAB sections) these are
 * the course's own required combination for the candidate's stream, not their 5 best credits
 * overall. Where a course requires fewer than 5 named subjects (e.g. "English, Maths, Economics +
 * 2 relevant subjects"), the remaining slots are filled with the candidate's best other results —
 * the rule base doesn't yet say which subjects count as "relevant" per course.
 *
 * A substitute (e.g. Agriculture for Biology) fills its required subject's slot, scoring its own
 * grade only when the substitution counts toward points; FUNAAB's doesn't, so that slot scores 0.
 * Two sittings cost policy.twoSittingDeductionPoints off the total.
 */
function scoreOLevel(
  candidate: CandidateProfileInput,
  requirement: RequirementRules,
  policy: ScoringPolicy,
) {
  const gradePoints = resolveGradePointsTable(policy);
  const best = bestResultsBySubject(candidate.oLevelResults);
  const { substitutions } = checkOLevelCredits(candidate.oLevelResults, requirement);

  const used = new Set<string>();
  let points = 0;
  const required = requirement.requiredOLevelSubjects.slice(0, SCORED_OLEVEL_SUBJECTS);
  for (const subject of required) {
    const substitution = substitutions.find((s) => s.subject === subject);
    if (substitution) {
      const key = substitution.usedSubject.toLowerCase();
      used.add(key);
      if (substitution.countsTowardPoints) points += gradePoints[best.get(key)!.grade];
      continue;
    }
    const own = best.get(subject.toLowerCase());
    used.add(subject.toLowerCase());
    if (own) points += gradePoints[own.grade];
  }

  const fillers = [...best.entries()]
    .filter(([key]) => !used.has(key))
    .map(([, result]) => gradePoints[result.grade])
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, SCORED_OLEVEL_SUBJECTS - required.length));
  points += fillers.reduce((sum, p) => sum + p, 0);

  if (candidate.oLevelSittings === 2 && policy.twoSittingDeductionPoints) {
    points = Math.max(0, points - policy.twoSittingDeductionPoints);
  }

  const maxPoints = Math.max(...Object.values(gradePoints)) * SCORED_OLEVEL_SUBJECTS;
  return { points, percent: (points / maxPoints) * 100 };
}

export type CatchmentStatus = "MERIT" | "CATCHMENT" | "ELDS";

export interface VerificationIssue {
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  field?: string;
}

export interface VerificationResult {
  eligible: boolean;
  checkedAt: string;
  utmeSubjectCheck: { passed: boolean; missing: string[]; invalid: string[] };
  oLevelCheck: { passed: boolean; missingCredits: string[]; creditCount: number };
  issues: VerificationIssue[];
}

export async function verifyEligibility(candidate: CandidateProfileInput): Promise<VerificationResult> {
  const [requirement, policy, university] = await Promise.all([
    prisma.admissionRequirement.findUnique({ where: { courseId: candidate.targetCourseId } }),
    prisma.scoringPolicy.findUnique({ where: { universityId: candidate.targetUniversityId } }),
    prisma.university.findUnique({ where: { id: candidate.targetUniversityId } }),
  ]);
  // Use Case 2's exception: a course with no rule base can't be verified. Passing the candidate by
  // default (an empty requirement checks nothing) would be a silent false "eligible".
  if (!requirement) {
    throw badRequest(
      "No admission requirement is configured for this course yet, so eligibility can't be checked. An administrator needs to add one.",
    );
  }
  const issues: VerificationIssue[] = [];

  const utme = checkUtmeSubjects(candidate.utmeSubjects, requirement);
  utme.missing.forEach((s) =>
    issues.push({
      code: "UTME_SUBJECT_MISSING",
      severity: "ERROR",
      message: `${s} is a compulsory UTME subject for this course but is not in your combination.`,
      field: "utmeSubjects",
    }),
  );
  utme.invalid.forEach((s) =>
    issues.push({
      code: "UTME_SUBJECT_NOT_ACCEPTED",
      severity: "WARNING",
      message: `${s} is not among the subjects accepted for this course, so it will not count.`,
      field: "utmeSubjects",
    }),
  );

  const oLevel = checkOLevelCredits(candidate.oLevelResults, requirement);
  oLevel.missingCredits.forEach((s) =>
    issues.push({
      code: "OLEVEL_CREDIT_MISSING",
      severity: "ERROR",
      message: `You need at least a credit (C6 or better) in ${s}.`,
      field: "oLevelResults",
    }),
  );
  if (oLevel.creditCount < requirement.minimumCredits) {
    issues.push({
      code: "OLEVEL_CREDIT_COUNT",
      severity: "ERROR",
      message: `This course requires ${requirement.minimumCredits} credit passes; you currently have ${oLevel.creditCount}.`,
      field: "oLevelResults",
    });
  }
  oLevel.substitutions.forEach((sub) =>
    issues.push({
      code: "OLEVEL_SUBSTITUTE_USED",
      severity: "WARNING",
      message: sub.countsTowardPoints
        ? `Your ${sub.usedSubject} credit is accepted in place of ${sub.subject} for this course.`
        : `Your ${sub.usedSubject} credit is accepted in place of ${sub.subject} for eligibility, but it adds no points to your O'Level score at this university.`,
      field: "oLevelResults",
    }),
  );
  if (candidate.oLevelSittings === 2 && policy?.twoSittingDeductionPoints) {
    issues.push({
      code: "OLEVEL_TWO_SITTINGS",
      severity: "WARNING",
      message: `You combined two O'Level sittings. ${university?.name ?? "This university"} takes your best grade in each subject, then deducts ${policy.twoSittingDeductionPoints} point(s) from your O'Level score.`,
      field: "oLevelResults",
    });
  }

  // Some universities disqualify below a minimum Post-UTME percentage regardless of JAMB score
  // (e.g. UNILAG, Likely 12% — see docs/jamb-data-dossier.md). Only checked when the candidate
  // has actually sat Post-UTME; a null score is "can't score yet," handled elsewhere, not a fail.
  let postUtmePassed = true;
  if (policy?.minPostUtmePercent != null && candidate.postUtmeScore !== null) {
    const postUtmePercent = (candidate.postUtmeScore / policy.postUtmeMaxScore) * 100;
    postUtmePassed = postUtmePercent >= policy.minPostUtmePercent;
    if (!postUtmePassed) {
      issues.push({
        code: "POST_UTME_BELOW_MINIMUM",
        severity: "ERROR",
        message: `This university disqualifies candidates scoring below ${policy.minPostUtmePercent}% in Post-UTME screening, regardless of JAMB score.`,
        field: "postUtmeScore",
      });
    }
  }

  return {
    eligible: utme.passed && oLevel.passed && postUtmePassed,
    checkedAt: new Date().toISOString(),
    utmeSubjectCheck: { passed: utme.passed, missing: utme.missing, invalid: utme.invalid },
    oLevelCheck: { passed: oLevel.passed, missingCredits: oLevel.missingCredits, creditCount: oLevel.creditCount },
    issues,
  };
}

export interface CatchmentResult {
  status: CatchmentStatus;
  reason: string;
  explanation: string;
  quotaSharePercent: number;
}

export async function classifyCatchment(candidate: CandidateProfileInput): Promise<CatchmentResult> {
  const [rule, university] = await Promise.all([
    prisma.catchmentRule.findUnique({ where: { universityId: candidate.targetUniversityId } }),
    prisma.university.findUnique({ where: { id: candidate.targetUniversityId } }),
  ]);
  const uniName = university?.name ?? "this university";

  if (rule && rule.eldsStates.includes(candidate.stateOfOrigin)) {
    return {
      status: "ELDS",
      reason: `${candidate.stateOfOrigin} is on the Educationally Less Developed States list.`,
      explanation: `Candidates from ELDS states compete for a reserved ${rule.eldsQuotaPercent}% of places at ${uniName}, usually at a lower cut-off than merit candidates. You are still considered for merit places first.`,
      quotaSharePercent: rule.eldsQuotaPercent,
    };
  }
  if (
    rule &&
    (rule.catchmentStates.includes(candidate.stateOfOrigin) ||
      rule.catchmentStates.includes(candidate.schoolLocationState))
  ) {
    return {
      status: "CATCHMENT",
      reason: `${candidate.stateOfOrigin} falls inside the catchment area of ${uniName}.`,
      explanation: `About ${rule.catchmentQuotaPercent}% of places go to catchment candidates, so your cut-off is slightly lower than the merit cut-off. You are still considered for merit places first.`,
      quotaSharePercent: rule.catchmentQuotaPercent,
    };
  }
  return {
    status: "MERIT",
    reason: `${candidate.stateOfOrigin} is outside both the catchment and ELDS lists for ${uniName}.`,
    explanation: `You will be considered on merit only — roughly ${rule?.meritQuotaPercent ?? 45}% of places, open to candidates nationwide. This is the most competitive route, so your aggregate must clear the full merit cut-off.`,
    quotaSharePercent: rule?.meritQuotaPercent ?? 45,
  };
}

/** Which of the candidate's two states actually matched the catchment list — mirrors classifyCatchment's own matching order. */
function matchedCatchmentState(candidate: CandidateProfileInput, rule: CatchmentRule | null): string | null {
  if (!rule) return null;
  if (rule.catchmentStates.includes(candidate.stateOfOrigin)) return candidate.stateOfOrigin;
  if (rule.catchmentStates.includes(candidate.schoolLocationState)) return candidate.schoolLocationState;
  return null;
}

/** Prisma's Json fields come back as JsonValue — narrow to the Record<string, number> shape Course actually stores. */
function asCutOffMap(value: Course["catchmentCutOffByState"]): Record<string, number> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, number>;
}

/**
 * Resolves the cut-off that actually applies to this candidate. Some universities (e.g. UNILAG, OAU)
 * publish a distinct cut-off per catchment/ELDS state rather than one flat figure per course — this
 * looks up the candidate's matched state first, falling back to the course's university-wide default.
 */
function resolveCutOff(
  course: Course,
  status: CatchmentStatus,
  candidate: CandidateProfileInput,
  rule: CatchmentRule | null,
): { value: number | null; state: string | null } {
  if (status === "MERIT") return { value: course.meritCutOff, state: null };
  if (status === "ELDS") {
    const state = candidate.stateOfOrigin;
    const specific = asCutOffMap(course.eldsCutOffByState)?.[state];
    return specific !== undefined ? { value: specific, state } : { value: course.eldsCutOff, state: null };
  }
  const state = matchedCatchmentState(candidate, rule);
  const specific = state ? asCutOffMap(course.catchmentCutOffByState)?.[state] : undefined;
  return specific !== undefined && state !== null
    ? { value: specific, state }
    : { value: course.catchmentCutOff, state: null };
}

interface ApplicableCutOff {
  value: number;
  type: CatchmentStatus;
  basis: CutOffBasis;
  state: string | null;
}

/**
 * The cut-off this candidate is actually judged against. Catchment and ELDS candidates are
 * considered for merit places first, so clearing the merit cut-off is enough for them; otherwise
 * their own status's cut-off applies, falling back to the merit cut-off when the university
 * publishes no separate catchment/ELDS figure for the course (UNILAG, FUTA, FUOYE mostly don't).
 * A course with no 0–100 cut-off at all but a raw JAMB cut-off (Course.utmeCutOff — FUNAAB) is
 * judged on the candidate's UTME score instead. Null when nothing is published yet.
 */
function resolveApplicableCutOff(
  course: Course,
  status: CatchmentStatus,
  candidate: CandidateProfileInput,
  rule: CatchmentRule | null,
  aggregate: number,
): ApplicableCutOff | null {
  const merit = course.meritCutOff;
  const meritCutOff = (value: number): ApplicableCutOff => ({
    value,
    type: "MERIT",
    basis: "AGGREGATE",
    state: null,
  });
  if (status === "MERIT") {
    if (merit !== null) return meritCutOff(merit);
  } else {
    if (merit !== null && aggregate >= merit) return meritCutOff(merit);
    const resolved = resolveCutOff(course, status, candidate, rule);
    if (resolved.value !== null) {
      return { value: resolved.value, type: status, basis: "AGGREGATE", state: resolved.state };
    }
    if (merit !== null) return meritCutOff(merit);
  }
  if (course.utmeCutOff != null) {
    return { value: course.utmeCutOff, type: status, basis: "UTME", state: null };
  }
  return null;
}

function requireApplicableCutOff(cutOff: ApplicableCutOff | null, courseName: string, status: CatchmentStatus) {
  if (cutOff === null) {
    throw badRequest(
      `No confirmed ${status.toLowerCase()} cut-off is available yet for "${courseName}" — see docs/jamb-data-dossier.md.`,
    );
  }
  return cutOff;
}

function compareWithCutOff(cutOff: ApplicableCutOff, aggregate: number, utmeScore: number) {
  const score = cutOff.basis === "UTME" ? utmeScore : aggregate;
  return { meetsCutOff: score >= cutOff.value, margin: round(score - cutOff.value) };
}

export type ScoreComponent = "UTME" | "POST_UTME" | "OLEVEL" | "SITTING_BONUS";
export type CutOffBasis = "AGGREGATE" | "UTME";

export interface AggregateScoreResult {
  aggregate: number;
  breakdown: { component: ScoreComponent; rawScore: number; weighting: number; contribution: number }[];
  formulaDescription: string;
  applicableCutOff: number;
  cutOffType: CatchmentStatus;
  /**
   * AGGREGATE: applicableCutOff and margin are on the 0–100 aggregate scale. UTME: the course only
   * publishes a raw JAMB cut-off (0–400, e.g. every FUNAAB course), so the candidate's UTME score
   * is what gets compared — the 0–100 aggregate is still shown, just not judged against a cut-off.
   */
  cutOffBasis: CutOffBasis;
  meetsCutOff: boolean;
  margin: number;
}

export interface SittingBonus {
  oneSitting: number;
  twoSittings: number;
}

export function asSittingBonus(value: unknown): SittingBonus | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { oneSitting, twoSittings } = value as Record<string, unknown>;
  if (typeof oneSitting !== "number" || typeof twoSittings !== "number") return null;
  return { oneSitting, twoSittings };
}

/** True when this university's formula has a Post-UTME term, so a missing score blocks the aggregate. */
export function needsPostUtmeScore(policy: Pick<ScoringPolicy, "postUtmeWeighting">) {
  return policy.postUtmeWeighting > 0;
}

/**
 * The aggregate itself, on a 0–100 scale. postUtmePercent is passed in rather than read off the
 * candidate so the recommender can score the same candidate under another university's formula.
 * Components with a 0% weighting are left out of the breakdown (FUNAAB/FUTA/FUOYE have no
 * Post-UTME term; UI uses O'Level only as an eligibility gate).
 */
function scoreCandidate(
  candidate: CandidateProfileInput,
  policy: ScoringPolicy,
  requirement: RequirementRules,
  postUtme: { rawScore: number; percent: number },
) {
  const utmePercent = (candidate.utmeScore / policy.utmeMaxScore) * 100;
  const { points: oLevelPoints, percent: oLevelPercent } = scoreOLevel(candidate, requirement, policy);

  const breakdown: AggregateScoreResult["breakdown"] = [
    {
      component: "UTME" as const,
      rawScore: candidate.utmeScore,
      weighting: policy.utmeWeighting,
      contribution: round((utmePercent * policy.utmeWeighting) / 100),
    },
    {
      component: "POST_UTME" as const,
      rawScore: postUtme.rawScore,
      weighting: policy.postUtmeWeighting,
      contribution: round((postUtme.percent * policy.postUtmeWeighting) / 100),
    },
    {
      component: "OLEVEL" as const,
      rawScore: oLevelPoints,
      weighting: policy.oLevelWeighting,
      contribution: round((oLevelPercent * policy.oLevelWeighting) / 100),
    },
  ].filter((b) => b.weighting > 0);

  // FUOYE (Likely): 10 points for a single sitting, 6 for two — added straight onto the aggregate.
  const bonus = asSittingBonus(policy.sittingBonus);
  if (bonus) {
    breakdown.push({
      component: "SITTING_BONUS",
      rawScore: candidate.oLevelSittings,
      weighting: bonus.oneSitting,
      contribution: candidate.oLevelSittings === 2 ? bonus.twoSittings : bonus.oneSitting,
    });
  }

  const formulaParts = [
    `UTME ${policy.utmeWeighting}%`,
    ...(policy.postUtmeWeighting > 0 ? [`Post-UTME ${policy.postUtmeWeighting}%`] : []),
    ...(policy.oLevelWeighting > 0 ? [`O'Level ${policy.oLevelWeighting}%`] : []),
    ...(bonus ? [`sitting bonus ${bonus.oneSitting}% (${bonus.twoSittings} for two sittings)`] : []),
  ];

  return {
    aggregate: round(breakdown.reduce((s, b) => s + b.contribution, 0)),
    breakdown,
    formulaDescription: formulaParts.join(" + "),
  };
}

async function loadCourseAndPolicy(candidate: CandidateProfileInput) {
  const [policy, course, requirement] = await Promise.all([
    prisma.scoringPolicy.findUnique({ where: { universityId: candidate.targetUniversityId } }),
    prisma.course.findUnique({ where: { id: candidate.targetCourseId } }),
    prisma.admissionRequirement.findUnique({ where: { courseId: candidate.targetCourseId } }),
  ]);
  if (!course || course.universityId !== candidate.targetUniversityId) {
    throw badRequest("targetCourseId does not belong to targetUniversityId");
  }
  if (!policy) {
    throw badRequest("No scoring policy is configured for targetUniversityId");
  }
  if (!requirement) {
    throw badRequest("No admission requirement is configured for targetCourseId");
  }
  return { policy, course, requirement };
}

/** Whether an aggregate can be computed yet: false only when the formula needs a Post-UTME score the candidate doesn't have. */
export async function canComputeAggregate(candidate: CandidateProfileInput) {
  if (candidate.postUtmeScore !== null) return true;
  const policy = await prisma.scoringPolicy.findUnique({ where: { universityId: candidate.targetUniversityId } });
  return !policy || !needsPostUtmeScore(policy);
}

export async function computeAggregate(candidate: CandidateProfileInput): Promise<AggregateScoreResult> {
  const { policy, course, requirement } = await loadCourseAndPolicy(candidate);

  if (needsPostUtmeScore(policy) && candidate.postUtmeScore === null) {
    throw new ApiError(
      422,
      "This university's formula includes a Post-UTME component, so an aggregate cannot be computed yet.",
      "Unprocessable Entity",
    );
  }

  const [catchment, rule] = await Promise.all([
    classifyCatchment(candidate),
    prisma.catchmentRule.findUnique({ where: { universityId: candidate.targetUniversityId } }),
  ]);

  const postUtmeRaw = candidate.postUtmeScore ?? 0;
  const { aggregate, breakdown, formulaDescription } = scoreCandidate(candidate, policy, requirement, {
    rawScore: postUtmeRaw,
    percent: (postUtmeRaw / policy.postUtmeMaxScore) * 100,
  });

  const cutOff = requireApplicableCutOff(
    resolveApplicableCutOff(course, catchment.status, candidate, rule, aggregate),
    course.name,
    catchment.status,
  );
  const { meetsCutOff, margin } = compareWithCutOff(cutOff, aggregate, candidate.utmeScore);

  return {
    aggregate,
    breakdown,
    formulaDescription,
    applicableCutOff: cutOff.value,
    cutOffType: cutOff.type,
    cutOffBasis: cutOff.basis,
    meetsCutOff,
    margin,
  };
}

export interface CourseRecommendation {
  rank: number;
  courseId: string;
  courseName: string;
  universityCode: string;
  faculty: string;
  matchProbability: number;
  requiredAggregate: number;
  rationale: string[];
}

export async function recommendCourses(candidate: CandidateProfileInput): Promise<CourseRecommendation[]> {
  if (!(await canComputeAggregate(candidate))) return [];
  const score = await computeAggregate(candidate);
  const catchment = await classifyCatchment(candidate);

  const [courses, rules] = await Promise.all([
    prisma.course.findMany({
      where: { id: { not: candidate.targetCourseId } },
      include: { university: true },
    }),
    prisma.catchmentRule.findMany(),
  ]);
  const ruleByUniversityId = new Map(rules.map((r) => [r.universityId, r]));

  return courses
    .map((course) => {
      const courseRule = ruleByUniversityId.get(course.universityId) ?? null;
      const cutOff = resolveCutOff(course, catchment.status, candidate, courseRule).value;
      return cutOff === null ? null : { course, cutOff };
    })
    .filter((entry): entry is { course: (typeof courses)[number]; cutOff: number } => entry !== null)
    .map(({ course, cutOff }) => {
      const headroom = score.aggregate - cutOff;
      const matchProbability = clamp(0.5 + headroom / 30, 0.02, 0.97);
      const rationale = [
        headroom >= 0
          ? `Your aggregate of ${score.aggregate} is ${round(headroom)} point(s) above the ${cutOff} cut-off.`
          : `Your aggregate of ${score.aggregate} is ${Math.abs(round(headroom))} point(s) short of the ${cutOff} cut-off.`,
        `${course.university.name} applies a ${catchment.status.toLowerCase()} cut-off in your case.`,
      ];
      return {
        rank: 0,
        courseId: course.id,
        courseName: course.name,
        universityCode: course.university.code,
        faculty: course.faculty,
        matchProbability: round(matchProbability, 2),
        requiredAggregate: cutOff,
        rationale,
      };
    })
    .sort((a, b) => b.matchProbability - a.matchProbability)
    .slice(0, 8)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface AssessmentContext {
  candidateName: string;
  stateOfOrigin: string;
  courseId: string;
  courseName: string;
  faculty: string;
  universityId: string;
  universityCode: string;
  universityName: string;
  catchmentStates: string[];
  requiredUtmeSubjects: string[];
  optionalUtmeSubjects: string[];
  requiredOLevelSubjects: string[];
  minimumCredits: number;
  // Nullable: the dossier has no confirmed figure for every course/status combination yet — see
  // Course.meritCutOff's doc comment in schema.prisma. This is a deliberate deviation from the
  // frontend's current (non-nullable) AssessmentContext.cutOffs type, flagged in the README.
  cutOffs: { merit: number | null; catchment: number | null; elds: number | null };
  /** Raw JAMB (0–400) cut-off, for courses that publish only that (FUNAAB). Null otherwise. */
  utmeCutOff: number | null;
  cutOffStates: { catchment: string | null; elds: string | null };
  quotaPercents: { merit: number; catchment: number; elds: number };
}

export async function buildAssessmentContext(candidate: CandidateProfileInput): Promise<AssessmentContext> {
  const [course, university, requirement, rule] = await Promise.all([
    prisma.course.findUnique({ where: { id: candidate.targetCourseId } }),
    prisma.university.findUnique({ where: { id: candidate.targetUniversityId } }),
    prisma.admissionRequirement.findUnique({ where: { courseId: candidate.targetCourseId } }),
    prisma.catchmentRule.findUnique({ where: { universityId: candidate.targetUniversityId } }),
  ]);
  if (!course) throw badRequest("targetCourseId does not correspond to a real course");
  if (!university) throw badRequest("targetUniversityId does not correspond to a real university");
  if (!requirement) throw badRequest("No admission requirement is configured for targetCourseId");

  const merit = resolveCutOff(course, "MERIT", candidate, rule);
  const catchment = resolveCutOff(course, "CATCHMENT", candidate, rule);
  const elds = resolveCutOff(course, "ELDS", candidate, rule);

  return {
    candidateName: candidate.fullName,
    stateOfOrigin: candidate.stateOfOrigin,
    courseId: course.id,
    courseName: course.name,
    faculty: course.faculty,
    universityId: university.id,
    universityCode: university.code,
    universityName: university.name,
    catchmentStates: rule?.catchmentStates ?? [],
    requiredUtmeSubjects: requirement.requiredUtmeSubjects,
    optionalUtmeSubjects: requirement.optionalUtmeSubjects,
    requiredOLevelSubjects: requirement.requiredOLevelSubjects,
    minimumCredits: requirement.minimumCredits,
    cutOffs: { merit: merit.value, catchment: catchment.value, elds: elds.value },
    utmeCutOff: course.utmeCutOff,
    cutOffStates: { catchment: catchment.state, elds: elds.state },
    quotaPercents: {
      merit: rule?.meritQuotaPercent ?? 45,
      catchment: rule?.catchmentQuotaPercent ?? 35,
      elds: rule?.eldsQuotaPercent ?? 20,
    },
  };
}

function round(n: number, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
