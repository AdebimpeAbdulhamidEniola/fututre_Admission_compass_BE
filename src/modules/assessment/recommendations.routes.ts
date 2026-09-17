import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { candidateProfileInputSchema } from "./candidate-profile.schema.js";
import * as engine from "./engine.js";
import { withEvaluationLog } from "./evaluation-logger.js";

export const recommendationsRouter = Router();

const recommendPayloadSchema = z.object({
  candidate: candidateProfileInputSchema,
  limit: z.number().int().positive().optional(),
});

recommendationsRouter.post(
  "/recommendations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { candidate, limit } = parseOrThrow(recommendPayloadSchema, req.body);
    const all = await withEvaluationLog("RECOMMENDATION", candidate.id, () =>
      engine.recommendCourses(candidate),
    );
    res.status(200).json(limit ? all.slice(0, limit) : all);
  }),
);
