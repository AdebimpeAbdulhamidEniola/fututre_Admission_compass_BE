import type { AssessmentReport as PrismaAssessmentReport } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import type { CandidateProfileInput } from "../assessment/candidate-profile.schema.js";
import * as engine from "../assessment/engine.js";
import { withEvaluationLog } from "../assessment/evaluation-logger.js";

/** Matches AssessmentReport in the frontend's src/types/domain.ts. */
function serializeReport(report: PrismaAssessmentReport) {
  return {
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    candidateId: report.candidateProfileId,
    verification: report.verification,
    score: report.score,
    catchment: report.catchment,
    recommendations: report.recommendations,
    context: report.context,
  };
}

async function requireOwnCandidateProfileId(userId: string): Promise<string> {
  const profile = await prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) {
    throw new ApiError(
      400,
      "Create a candidate profile (POST /candidates/profile) before running an assessment.",
      "Bad Request",
    );
  }
  return profile.id;
}

export async function createAssessment(userId: string, candidate: CandidateProfileInput) {
  const candidateProfileId = await requireOwnCandidateProfileId(userId);

  const [verification, catchment, context] = await Promise.all([
    withEvaluationLog("VERIFICATION", candidate.id, () => engine.verifyEligibility(candidate)),
    withEvaluationLog("CATCHMENT", candidate.id, () => engine.classifyCatchment(candidate)),
    engine.buildAssessmentContext(candidate),
  ]);
  const score =
    candidate.postUtmeScore === null
      ? null
      : await withEvaluationLog("SCORING", candidate.id, () => engine.computeAggregate(candidate));
  const recommendations = await withEvaluationLog("RECOMMENDATION", candidate.id, () =>
    engine.recommendCourses(candidate),
  );

  const report = await prisma.assessmentReport.create({
    data: {
      candidateProfileId,
      courseId: candidate.targetCourseId,
      verification,
      score: score ?? undefined,
      catchment,
      recommendations,
      context,
    },
  });

  return serializeReport(report);
}

export async function listAssessments(userId: string) {
  const candidateProfileId = await requireOwnCandidateProfileId(userId);
  const reports = await prisma.assessmentReport.findMany({
    where: { candidateProfileId },
    orderBy: { createdAt: "desc" },
  });
  return reports.map(serializeReport);
}

export async function getAssessment(userId: string, id: string) {
  const candidateProfileId = await requireOwnCandidateProfileId(userId);
  const report = await prisma.assessmentReport.findUnique({ where: { id } });
  // Treat another candidate's report as not found, not forbidden — don't confirm it exists.
  // Matches the frontend mock's exact message (src/lib/api/assessments.ts).
  if (!report || report.candidateProfileId !== candidateProfileId) {
    throw new ApiError(404, "That assessment report could not be found.", "Not Found");
  }
  return serializeReport(report);
}
