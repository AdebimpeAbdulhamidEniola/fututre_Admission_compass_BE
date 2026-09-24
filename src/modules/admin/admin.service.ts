import { prisma } from "../../db/client.js";
import { notFound } from "../../lib/errors.js";
import { serializeCourse, serializeScoringPolicy } from "../catalog/catalog.service.js";
import type {
  CatchmentRuleUpdateInput,
  CatchmentRuleInput,
  CourseInput,
  CourseUpdateInput,
  RequirementInput,
  RequirementUpdateInput,
  ScoringPolicyInput,
  ScoringPolicyUpdateInput,
  UniversityInput,
  UniversityUpdateInput,
} from "./admin.types.js";

async function logAdminAction(actorId: string, action: string, entity: string, summary: string) {
  await prisma.adminLogEntry.create({ data: { actorId, action, entity, summary } });
}

// --- Universities --------------------------------------------------------------------------

export async function listUniversities() {
  return prisma.university.findMany({ orderBy: { name: "asc" } });
}

export async function createUniversity(actorId: string, input: UniversityInput) {
  const university = await prisma.university.create({ data: input });
  await logAdminAction(actorId, "CREATE", "University", `Created ${university.name} (${university.code})`);
  return university;
}

export async function updateUniversity(actorId: string, id: string, input: UniversityUpdateInput) {
  const existing = await prisma.university.findUnique({ where: { id } });
  if (!existing) throw notFound("University");
  const university = await prisma.university.update({ where: { id }, data: input });
  await logAdminAction(actorId, "UPDATE", "University", `Updated ${university.name} (${university.code})`);
  return university;
}

export async function deleteUniversity(actorId: string, id: string) {
  const existing = await prisma.university.findUnique({ where: { id } });
  if (!existing) throw notFound("University");
  await prisma.university.delete({ where: { id } });
  await logAdminAction(actorId, "DELETE", "University", `Deleted ${existing.name} (${existing.code})`);
  return { id };
}

// --- Courses ---------------------------------------------------------------------------------

export async function listCourses() {
  const courses = await prisma.course.findMany({ orderBy: { name: "asc" } });
  return courses.map(serializeCourse);
}

export async function createCourse(actorId: string, input: CourseInput) {
  const course = await prisma.course.create({ data: input });
  await logAdminAction(actorId, "CREATE", "Course", `Created ${course.name}`);
  return serializeCourse(course);
}

export async function updateCourse(actorId: string, id: string, input: CourseUpdateInput) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) throw notFound("Course");
  const course = await prisma.course.update({ where: { id }, data: input });
  await logAdminAction(actorId, "UPDATE", "Course", `Updated ${course.name}`);
  return serializeCourse(course);
}

export async function deleteCourse(actorId: string, id: string) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) throw notFound("Course");
  await prisma.course.delete({ where: { id } });
  await logAdminAction(actorId, "DELETE", "Course", `Deleted ${existing.name}`);
  return { id };
}

// --- Admission requirements ------------------------------------------------------------------

export async function listRequirements() {
  return prisma.admissionRequirement.findMany();
}

export async function createRequirement(actorId: string, input: RequirementInput) {
  const requirement = await prisma.admissionRequirement.create({ data: input });
  await logAdminAction(actorId, "CREATE", "AdmissionRequirement", `Created requirement for course ${requirement.courseId}`);
  return requirement;
}

export async function updateRequirement(actorId: string, id: string, input: RequirementUpdateInput) {
  const existing = await prisma.admissionRequirement.findUnique({ where: { id } });
  if (!existing) throw notFound("Admission requirement");
  const requirement = await prisma.admissionRequirement.update({ where: { id }, data: input });
  await logAdminAction(actorId, "UPDATE", "AdmissionRequirement", `Updated requirement for course ${requirement.courseId}`);
  return requirement;
}

export async function deleteRequirement(actorId: string, id: string) {
  const existing = await prisma.admissionRequirement.findUnique({ where: { id } });
  if (!existing) throw notFound("Admission requirement");
  await prisma.admissionRequirement.delete({ where: { id } });
  await logAdminAction(actorId, "DELETE", "AdmissionRequirement", `Deleted requirement for course ${existing.courseId}`);
  return { id };
}

// --- Scoring policies --------------------------------------------------------------------------

export async function listScoringPolicies() {
  const policies = await prisma.scoringPolicy.findMany();
  return policies.map(serializeScoringPolicy);
}

export async function createScoringPolicy(actorId: string, input: ScoringPolicyInput) {
  const policy = await prisma.scoringPolicy.create({ data: input });
  await logAdminAction(actorId, "CREATE", "ScoringPolicy", `Created scoring policy for university ${policy.universityId}`);
  return serializeScoringPolicy(policy);
}

export async function updateScoringPolicy(actorId: string, id: string, input: ScoringPolicyUpdateInput) {
  const existing = await prisma.scoringPolicy.findUnique({ where: { id } });
  if (!existing) throw notFound("Scoring policy");
  const policy = await prisma.scoringPolicy.update({ where: { id }, data: input });
  await logAdminAction(actorId, "UPDATE", "ScoringPolicy", `Updated scoring policy for university ${policy.universityId}`);
  return serializeScoringPolicy(policy);
}

export async function deleteScoringPolicy(actorId: string, id: string) {
  const existing = await prisma.scoringPolicy.findUnique({ where: { id } });
  if (!existing) throw notFound("Scoring policy");
  await prisma.scoringPolicy.delete({ where: { id } });
  await logAdminAction(actorId, "DELETE", "ScoringPolicy", `Deleted scoring policy for university ${existing.universityId}`);
  return { id };
}

// --- Catchment rules --------------------------------------------------------------------------

export async function listCatchmentRules() {
  return prisma.catchmentRule.findMany();
}

export async function createCatchmentRule(actorId: string, input: CatchmentRuleInput) {
  const rule = await prisma.catchmentRule.create({ data: input });
  await logAdminAction(actorId, "CREATE", "CatchmentRule", `Created catchment rule for university ${rule.universityId}`);
  return rule;
}

export async function updateCatchmentRule(actorId: string, id: string, input: CatchmentRuleUpdateInput) {
  const existing = await prisma.catchmentRule.findUnique({ where: { id } });
  if (!existing) throw notFound("Catchment rule");
  const rule = await prisma.catchmentRule.update({ where: { id }, data: input });
  await logAdminAction(actorId, "UPDATE", "CatchmentRule", `Updated catchment rule for university ${rule.universityId}`);
  return rule;
}

export async function deleteCatchmentRule(actorId: string, id: string) {
  const existing = await prisma.catchmentRule.findUnique({ where: { id } });
  if (!existing) throw notFound("Catchment rule");
  await prisma.catchmentRule.delete({ where: { id } });
  await logAdminAction(actorId, "DELETE", "CatchmentRule", `Deleted catchment rule for university ${existing.universityId}`);
  return { id };
}

