import { z } from "zod";

// Mirrors OLevelGrade / CandidateProfile in the frontend's src/types/domain.ts exactly.
export const oLevelGradeSchema = z.enum(["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"]);

export const oLevelResultSchema = z.object({
  subject: z.string().min(1),
  grade: oLevelGradeSchema,
});

/** 1 or 2 — how many O'Level sittings the candidate combined. Defaults to 1 when omitted. */
export const oLevelSittingsSchema = z.union([z.literal(1), z.literal(2)]).default(1);

/**
 * The shape sent inline in every Stage 4 engine call (POST /eligibility/verify,
 * /scoring/aggregate, /catchment/classify, /recommendations, /assessments) — the frontend
 * posts the full candidate object each time rather than referencing a saved profile by id.
 */
export const candidateProfileInputSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  stateOfOrigin: z.string().min(1),
  lga: z.string().min(1),
  schoolLocationState: z.string().min(1),
  utmeScore: z.number().int().min(0).max(400),
  postUtmeScore: z.number().int().min(0).nullable(),
  utmeSubjects: z.array(z.string().min(1)),
  oLevelResults: z.array(oLevelResultSchema),
  oLevelSittings: oLevelSittingsSchema,
  targetCourseId: z.string().min(1),
  targetUniversityId: z.string().min(1),
});
export type CandidateProfileInput = z.infer<typeof candidateProfileInputSchema>;

export const candidatePayloadSchema = z.object({ candidate: candidateProfileInputSchema });
