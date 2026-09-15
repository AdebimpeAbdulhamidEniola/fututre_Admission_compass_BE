import type { Course as PrismaCourse } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { notFound } from "../../lib/errors.js";

/** Prisma's Json fields come back as JsonValue (string | number | ... | null) — narrow to what Course actually stores. */
function toCutOffMap(value: PrismaCourse["catchmentCutOffByState"]): Record<string, number> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, number>;
}

/** Matches the frontend's Course type exactly (src/types/domain.ts) — null JSON fields become undefined. */
function serializeCourse(course: PrismaCourse) {
  const catchmentCutOffByState = toCutOffMap(course.catchmentCutOffByState);
  const eldsCutOffByState = toCutOffMap(course.eldsCutOffByState);

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
  return policy;
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
