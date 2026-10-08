import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../db/client.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { recommendCourses, saveRecommendations } from "../recommender/recommender.js";
import { candidateProfileInputSchema } from "./candidate-profile.schema.js";
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
    const all = await withEvaluationLog("RECOMMENDATION", candidate.id, () => recommendCourses(candidate));
    const result = limit ? all.slice(0, limit) : all;

    // Kept as Recommendation rows when the user has a saved profile to attach them to.
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });
    if (profile) await saveRecommendations(profile.id, result, null);

    res.status(200).json(result);
  }),
);
