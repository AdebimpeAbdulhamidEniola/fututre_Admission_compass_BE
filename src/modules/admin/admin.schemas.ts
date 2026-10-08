import { z } from "zod";

// Every schema here matches Omit<T, "id"> in the frontend's src/types/domain.ts exactly;
// the `.partial()` update variant matches Partial<T>.

export const universitySchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  locationState: z.string().trim().min(1),
});
export const universityUpdateSchema = universitySchema.partial();

const cutOffByStateSchema = z.record(z.string(), z.number());

export const courseSchema = z.object({
  universityId: z.string().min(1),
  name: z.string().trim().min(1),
  faculty: z.string().trim().min(1),
  // Nullable on purpose — "not yet confirmed" is a real, honest state (see docs/jamb-data-dossier.md),
  // never a value to fabricate a default for.
  meritCutOff: z.number().min(0).max(400).nullable(),
  catchmentCutOff: z.number().min(0).max(400).nullable(),
  eldsCutOff: z.number().min(0).max(400).nullable(),
  catchmentCutOffByState: cutOffByStateSchema.optional(),
  eldsCutOffByState: cutOffByStateSchema.optional(),
  // Raw JAMB (0–400) cut-off, for courses that publish no 0–100 aggregate cut-off (FUNAAB).
  utmeCutOff: z.number().int().min(0).max(400).nullable().optional(),
});
export const courseUpdateSchema = courseSchema.partial();

export const requirementSchema = z.object({
  courseId: z.string().min(1),
  requiredUtmeSubjects: z.array(z.string().min(1)),
  optionalUtmeSubjects: z.array(z.string().min(1)),
  utmeSubjectGroups: z.array(z.array(z.string().trim().min(1)).min(1)).optional(),
  requiredOLevelSubjects: z.array(z.string().min(1)),
  minimumCredits: z.number().int().min(0).max(9),
  oLevelSubstitutions: z
    .array(
      z.object({
        subject: z.string().trim().min(1),
        alternatives: z.array(z.string().trim().min(1)).min(1),
        countsTowardPoints: z.boolean(),
      }),
    )
    .optional(),
});
export const requirementUpdateSchema = requirementSchema.partial();

const oLevelGradePointsSchema = z.record(
  z.enum(["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"]),
  z.number(),
);

export const scoringPolicySchema = z.object({
  universityId: z.string().min(1),
  utmeWeighting: z.number().min(0).max(100),
  postUtmeWeighting: z.number().min(0).max(100),
  oLevelWeighting: z.number().min(0).max(100),
  utmeMaxScore: z.number().positive(),
  postUtmeMaxScore: z.number().positive(),
  oLevelGradePoints: oLevelGradePointsSchema.optional(),
  minPostUtmePercent: z.number().min(0).max(100).optional(),
  twoSittingDeductionPoints: z.number().min(0).optional(),
  sittingBonus: z
    .object({ oneSitting: z.number().min(0).max(100), twoSittings: z.number().min(0).max(100) })
    .optional(),
});
export const scoringPolicyUpdateSchema = scoringPolicySchema.partial();

export const catchmentRuleSchema = z.object({
  universityId: z.string().min(1),
  catchmentStates: z.array(z.string().min(1)),
  eldsStates: z.array(z.string().min(1)),
  meritQuotaPercent: z.number().min(0).max(100),
  catchmentQuotaPercent: z.number().min(0).max(100),
  eldsQuotaPercent: z.number().min(0).max(100),
});
export const catchmentRuleUpdateSchema = catchmentRuleSchema.partial();
