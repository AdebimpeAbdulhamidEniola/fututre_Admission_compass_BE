/**
 * Alternative-course recommendations (Module 4). Runs only for a candidate who passed the subject
 * and O'Level checks for their chosen course but scored below its cut-off (thesis §3.2.2). Every
 * other course they're also eligible for is scored with that course's own university formula, then
 * ranked by the Decision Tree's estimated probability of admission.
 */
import { prisma } from "../../db/client.js";
import type { CandidateProfileInput } from "../assessment/candidate-profile.schema.js";
import * as engine from "../assessment/engine.js";
import { toFeatures } from "./features.js";
import { getModel } from "./model.js";

const MAX_RECOMMENDATIONS = 8;

/** Courses with fewer training rows than this get a low-confidence flag (Use Case 4's exception). */
const MIN_TRAINING_ROWS = 5;

export interface CourseRecommendation {
  rank: number;
  courseId: string;
  courseName: string;
  universityCode: string;
  faculty: string;
  matchProbability: number;
  /** The cut-off for this course — a 0–100 aggregate, or a raw JAMB score when cutOffBasis is "UTME". */
  requiredAggregate: number;
  /** The candidate's own score for this course, on the same basis as requiredAggregate. */
  candidateScore: number;
  cutOffBasis: engine.CutOffBasis;
  /** True when the model saw too few similar cases to be confident about this course. */
  lowConfidence: boolean;
  rationale: string[];
}

function round(n: number, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function rationaleFor(
  evaluation: engine.CourseEvaluation,
  candidateScore: number,
  postUtmeAssumed: boolean,
  lowConfidence: boolean,
) {
  const { cutOff, margin, course } = evaluation;
  const what = cutOff.basis === "UTME" ? "UTME score" : "aggregate";
  const cutOffName = cutOff.basis === "UTME" ? "JAMB cut-off" : `${cutOff.type.toLowerCase()} cut-off`;
  const lines = [
    margin >= 0
      ? `Your ${what} of ${candidateScore} is ${round(margin)} point(s) above the ${cutOff.value} ${cutOffName}.`
      : `Your ${what} of ${candidateScore} is ${Math.abs(round(margin))} point(s) short of the ${cutOff.value} ${cutOffName}.`,
    `${course.university.name} classifies you as ${evaluation.status.toLowerCase()} and its formula gives you ${evaluation.aggregate}/100.`,
  ];
  if (postUtmeAssumed) {
    lines.push(`Assumes you score the same percentage in ${course.university.code}'s Post-UTME as in your current one.`);
  }
  if (lowConfidence) {
    lines.push("Few comparable profiles in the training data — treat this match as a rough guide.");
  }
  return lines;
}

export async function recommendCourses(
  candidate: CandidateProfileInput,
  known?: { verification?: engine.VerificationResult; score?: engine.AggregateScoreResult | null },
): Promise<CourseRecommendation[]> {
  const verification = known?.verification ?? (await engine.verifyEligibility(candidate));
  if (!verification.eligible) return [];
  if (known?.score === null || !(await engine.canComputeAggregate(candidate))) return [];
  const score = known?.score ?? (await engine.computeAggregate(candidate));
  if (score.meetsCutOff) return [];

  const [catalog, model] = await Promise.all([engine.loadCatalog(), getModel()]);
  const targetPolicy = catalog.policyByUniversityId.get(candidate.targetUniversityId);
  const postUtmePercent =
    candidate.postUtmeScore !== null && targetPolicy
      ? (candidate.postUtmeScore / targetPolicy.postUtmeMaxScore) * 100
      : null;

  const ranked = catalog.courses
    .filter((course) => course.id !== candidate.targetCourseId)
    .map((course) => engine.evaluateCourse(candidate, postUtmePercent, course, catalog))
    .filter((evaluation): evaluation is engine.CourseEvaluation => evaluation !== null)
    .map((evaluation) => {
      const probability = model.predictProbability(toFeatures(evaluation, candidate.oLevelSittings));
      const lowConfidence = (model.saved.rowsPerCourse[evaluation.course.id] ?? 0) < MIN_TRAINING_ROWS;
      const candidateScore = evaluation.cutOff.basis === "UTME" ? candidate.utmeScore : evaluation.aggregate;
      const postUtmeAssumed =
        evaluation.postUtmePercent !== null && evaluation.course.universityId !== candidate.targetUniversityId;
      return { evaluation, probability, lowConfidence, candidateScore, postUtmeAssumed };
    })
    // Most likely admission first; between equal estimates, the bigger cut-off margin.
    .sort((a, b) => b.probability - a.probability || b.evaluation.margin - a.evaluation.margin)
    .slice(0, MAX_RECOMMENDATIONS);

  return ranked.map(({ evaluation, probability, lowConfidence, candidateScore, postUtmeAssumed }, i) => ({
    rank: i + 1,
    courseId: evaluation.course.id,
    courseName: evaluation.course.name,
    universityCode: evaluation.course.university.code,
    faculty: evaluation.course.faculty,
    matchProbability: round(probability, 2),
    requiredAggregate: evaluation.cutOff.value,
    candidateScore,
    cutOffBasis: evaluation.cutOff.basis,
    lowConfidence,
    rationale: rationaleFor(evaluation, candidateScore, postUtmeAssumed, lowConfidence),
  }));
}

/** Persists recommendations as Recommendation rows (thesis ERD: candidate → suggested course + match probability). */
export async function saveRecommendations(
  candidateProfileId: string,
  recommendations: CourseRecommendation[],
  assessmentReportId: string | null,
) {
  if (recommendations.length === 0) return;
  await prisma.recommendation.createMany({
    data: recommendations.map((r) => ({
      candidateProfileId,
      assessmentReportId,
      courseId: r.courseId,
      rank: r.rank,
      matchProbability: r.matchProbability,
      lowConfidence: r.lowConfidence,
    })),
  });
}
