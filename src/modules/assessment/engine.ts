/**
 * Ports src/mocks/engine.ts from the frontend repo — the reference implementation for
 * eligibility, scoring, catchment classification, and recommendations — onto real Postgres
 * data via Prisma instead of in-memory mock arrays. Keep this logic in lockstep with the
 * frontend's engine.ts; it's the single source of truth for the business rules.
 */
import type { CatchmentRule, Course, OLevelGrade } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { badRequest } from "../../lib/errors.js";
import type { CandidateProfileInput } from "./candidate-profile.schema.js";

const GRADE_POINTS: Record<OLevelGrade, number> = {
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
  const requirement = await prisma.admissionRequirement.findUnique({
    where: { courseId: candidate.targetCourseId },
  });
  const issues: VerificationIssue[] = [];

  const subjects = candidate.utmeSubjects.filter((s) => s !== "Use of English");
  const required = requirement?.requiredUtmeSubjects ?? [];
  const allowed = [...required, ...(requirement?.optionalUtmeSubjects ?? [])];

  const missing = required.filter((s) => !subjects.includes(s));
  const invalid = subjects.filter((s) => !allowed.includes(s));

  missing.forEach((s) =>
    issues.push({
      code: "UTME_SUBJECT_MISSING",
      severity: "ERROR",
      message: `${s} is a compulsory UTME subject for this course but is not in your combination.`,
      field: "utmeSubjects",
    }),
  );
  invalid.forEach((s) =>
    issues.push({
      code: "UTME_SUBJECT_NOT_ACCEPTED",
      severity: "WARNING",
      message: `${s} is not among the subjects accepted for this course, so it will not count.`,
      field: "utmeSubjects",
    }),
  );

  const credits = candidate.oLevelResults.filter((r) => CREDIT_GRADES.includes(r.grade));
  const creditSubjects = credits.map((r) => r.subject);
  const missingCredits = (requirement?.requiredOLevelSubjects ?? []).filter(
    (s) => !creditSubjects.includes(s),
  );
  const minimumCredits = requirement?.minimumCredits ?? 5;

  missingCredits.forEach((s) =>
    issues.push({
      code: "OLEVEL_CREDIT_MISSING",
      severity: "ERROR",
      message: `You need at least a credit (C6 or better) in ${s}.`,
      field: "oLevelResults",
    }),
  );
  if (credits.length < minimumCredits) {
    issues.push({
      code: "OLEVEL_CREDIT_COUNT",
      severity: "ERROR",
      message: `This course requires ${minimumCredits} credit passes; you currently have ${credits.length}.`,
      field: "oLevelResults",
    });
  }

  const utmePassed = missing.length === 0;
  const oLevelPassed = missingCredits.length === 0 && credits.length >= minimumCredits;

  return {
    eligible: utmePassed && oLevelPassed,
    checkedAt: new Date().toISOString(),
    utmeSubjectCheck: { passed: utmePassed, missing, invalid },
    oLevelCheck: { passed: oLevelPassed, missingCredits, creditCount: credits.length },
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
      explanation: `Candidates from ELDS states compete for a reserved ${rule.eldsQuotaPercent}% of places at ${uniName}, usually at a lower cut-off than merit candidates.`,
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
): { value: number; state: string | null } {
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

export interface AggregateScoreResult {
  aggregate: number;
  breakdown: { component: "UTME" | "POST_UTME" | "OLEVEL"; rawScore: number; weighting: number; contribution: number }[];
  formulaDescription: string;
  applicableCutOff: number;
  cutOffType: CatchmentStatus;
  meetsCutOff: boolean;
  margin: number;
}

async function loadCourseAndPolicy(candidate: CandidateProfileInput) {
  const [policy, course] = await Promise.all([
    prisma.scoringPolicy.findUnique({ where: { universityId: candidate.targetUniversityId } }),
    prisma.course.findUnique({ where: { id: candidate.targetCourseId } }),
  ]);
  if (!course || course.universityId !== candidate.targetUniversityId) {
    throw badRequest("targetCourseId does not belong to targetUniversityId");
  }
  if (!policy) {
    throw badRequest("No scoring policy is configured for targetUniversityId");
  }
  return { policy, course };
}

export async function computeAggregate(candidate: CandidateProfileInput): Promise<AggregateScoreResult> {
  const { policy, course } = await loadCourseAndPolicy(candidate);

  const catchment = await classifyCatchment(candidate);

  const utmePercent = (candidate.utmeScore / policy.utmeMaxScore) * 100;
  const postUtmePercent = ((candidate.postUtmeScore ?? 0) / policy.postUtmeMaxScore) * 100;
  const oLevelPoints = candidate.oLevelResults
    .slice(0, 5)
    .reduce((sum, r) => sum + GRADE_POINTS[r.grade], 0);
  const oLevelPercent = (oLevelPoints / 50) * 100;

  const breakdown: AggregateScoreResult["breakdown"] = [
    {
      component: "UTME",
      rawScore: candidate.utmeScore,
      weighting: policy.utmeWeighting,
      contribution: round((utmePercent * policy.utmeWeighting) / 100),
    },
    {
      component: "POST_UTME",
      rawScore: candidate.postUtmeScore ?? 0,
      weighting: policy.postUtmeWeighting,
      contribution: round((postUtmePercent * policy.postUtmeWeighting) / 100),
    },
    {
      component: "OLEVEL",
      rawScore: oLevelPoints,
      weighting: policy.oLevelWeighting,
      contribution: round((oLevelPercent * policy.oLevelWeighting) / 100),
    },
  ];

  const aggregate = round(breakdown.reduce((s, b) => s + b.contribution, 0));
  const rule = await prisma.catchmentRule.findUnique({ where: { universityId: candidate.targetUniversityId } });
  const applicableCutOff = resolveCutOff(course, catchment.status, candidate, rule).value;

  return {
    aggregate,
    breakdown,
    formulaDescription: `UTME ${policy.utmeWeighting}% + Post-UTME ${policy.postUtmeWeighting}% + O'Level ${policy.oLevelWeighting}%`,
    applicableCutOff,
    cutOffType: catchment.status,
    meetsCutOff: aggregate >= applicableCutOff,
    margin: round(aggregate - applicableCutOff),
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
  cutOffs: { merit: number; catchment: number; elds: number };
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
