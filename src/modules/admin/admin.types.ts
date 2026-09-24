import type { z } from "zod";

import type {
  catchmentRuleSchema,
  catchmentRuleUpdateSchema,
  courseSchema,
  courseUpdateSchema,
  requirementSchema,
  requirementUpdateSchema,
  scoringPolicySchema,
  scoringPolicyUpdateSchema,
  universitySchema,
  universityUpdateSchema,
} from "./admin.schemas.js";

export type UniversityInput = z.infer<typeof universitySchema>;
export type UniversityUpdateInput = z.infer<typeof universityUpdateSchema>;

export type CourseInput = z.infer<typeof courseSchema>;
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

export type RequirementInput = z.infer<typeof requirementSchema>;
export type RequirementUpdateInput = z.infer<typeof requirementUpdateSchema>;

export type ScoringPolicyInput = z.infer<typeof scoringPolicySchema>;
export type ScoringPolicyUpdateInput = z.infer<typeof scoringPolicyUpdateSchema>;

export type CatchmentRuleInput = z.infer<typeof catchmentRuleSchema>;
export type CatchmentRuleUpdateInput = z.infer<typeof catchmentRuleUpdateSchema>;
