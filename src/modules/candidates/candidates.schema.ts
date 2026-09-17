import { z } from "zod";

import { oLevelResultSchema } from "../assessment/candidate-profile.schema.js";

// Matches Omit<CandidateProfile, "id"> in the frontend's src/types/domain.ts.
export const createProfileSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  stateOfOrigin: z.string().min(1),
  lga: z.string().min(1),
  schoolLocationState: z.string().min(1),
  utmeScore: z.number().int().min(0).max(400),
  postUtmeScore: z.number().int().min(0).nullable(),
  utmeSubjects: z.array(z.string().min(1)),
  oLevelResults: z.array(oLevelResultSchema),
  targetCourseId: z.string().min(1),
  targetUniversityId: z.string().min(1),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

// Matches Partial<CandidateProfile> — every field optional, "id" ignored if sent.
export const updateProfileSchema = createProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
