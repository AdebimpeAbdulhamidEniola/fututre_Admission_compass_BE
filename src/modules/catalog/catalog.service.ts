import type { Course as PrismaCourse, ScoringPolicy as PrismaScoringPolicy } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { notFound } from "../../lib/errors.js";
import { toNumberMap } from "../../lib/prisma-json.js";

/** Matches the frontend's Course type exactly (src/types/domain.ts): meritCutOff/catchmentCutOff/
 * eldsCutOff are nullable (a real, un-fabricated "not yet confirmed" — see docs/jamb-data-dossier.md),
 * and null JSON by-state maps become undefined (an omitted key, not a `null` value). */
export function serializeCourse(course: PrismaCourse) {
  const catchmentCutOffByState = toNumberMap(course.catchmentCutOffByState);
  const eldsCutOffByState = toNumberMap(course.eldsCutOffByState);

  return {
    id: course.id,
    universityId: course.universityId,
    name: course.name,
    faculty: course.faculty,
    meritCutOff: course.meritCutOff,
    catchmentCutOff: course.catchmentCutOff,
    eldsCutOff: course.eldsCutOff,
    ...(catchmentCutOffByState ? { catchmentCutOffByState } : {}),
    ...(eldsCutOffByState ? { eldsCutOffByState } : {}),
  };
}

/** Matches the frontend's ScoringPolicy type exactly — null JSON/optional fields become undefined. */
export function serializeScoringPolicy(policy: PrismaScoringPolicy) {
  const oLevelGradePoints = toNumberMap(policy.oLevelGradePoints);
  return {
    id: policy.id,
    universityId: policy.universityId,
    utmeWeighting: policy.utmeWeighting,
    postUtmeWeighting: policy.postUtmeWeighting,
    oLevelWeighting: policy.oLevelWeighting,
    utmeMaxScore: policy.utmeMaxScore,
    postUtmeMaxScore: policy.postUtmeMaxScore,
    ...(oLevelGradePoints ? { oLevelGradePoints } : {}),
    ...(policy.minPostUtmePercent !== null ? { minPostUtmePercent: policy.minPostUtmePercent } : {}),
  };
}

export async function listUniversities() {
  return prisma.university.findMany({ orderBy: { name: "asc" } });
}

async function requireUniversity(universityId: string) {
  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) throw notFound("University");
  return university;
}

export async function listCoursesForUniversity(universityId: string) {
  await requireUniversity(universityId);
  const courses = await prisma.course.findMany({
    where: { universityId },
    orderBy: { name: "asc" },
  });
  return courses.map(serializeCourse);
}

export async function getScoringPolicy(universityId: string) {
  await requireUniversity(universityId);
  const policy = await prisma.scoringPolicy.findUnique({ where: { universityId } });
  if (!policy) throw notFound("Scoring policy");
  return serializeScoringPolicy(policy);
}

export async function getCatchmentRule(universityId: string) {
  await requireUniversity(universityId);
  const rule = await prisma.catchmentRule.findUnique({ where: { universityId } });
  if (!rule) throw notFound("Catchment rule");
  return rule;
}

export async function getCourseRequirements(courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound("Course");
  const requirement = await prisma.admissionRequirement.findUnique({ where: { courseId } });
  if (!requirement) throw notFound("Admission requirement");
  return requirement;
}
