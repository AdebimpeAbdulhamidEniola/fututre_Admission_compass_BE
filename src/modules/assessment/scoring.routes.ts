import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { candidatePayloadSchema } from "./candidate-profile.schema.js";
import * as engine from "./engine.js";
import { withEvaluationLog } from "./evaluation-logger.js";

export const scoringRouter = Router();

scoringRouter.post(
  "/scoring/aggregate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { candidate } = parseOrThrow(candidatePayloadSchema, req.body);
    // computeAggregate 422s when the university's formula has a Post-UTME term and the candidate
    // has no Post-UTME score yet; FUNAAB/FUTA/FUOYE have no such term, so they score without one.
    const result = await withEvaluationLog("SCORING", candidate.id, () => engine.computeAggregate(candidate));
    res.status(200).json(result);
  }),
);
