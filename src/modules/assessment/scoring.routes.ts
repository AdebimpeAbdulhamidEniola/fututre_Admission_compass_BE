import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/errors.js";
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

    // Matches the frontend mock's exact API-layer rule (src/lib/api/scoring.ts): an aggregate
    // can't be computed until the candidate has a Post-UTME score, full stop — this predates
    // the later finding that some universities (FUNAAB, FUTA, FUOYE) don't actually use
    // Post-UTME at all, so the message is a known inaccuracy in the existing contract, not
    // something to fix unilaterally here.
    if (candidate.postUtmeScore === null) {
      throw new ApiError(
        422,
        "This university's formula includes a Post-UTME component, so an aggregate cannot be computed yet.",
        "Unprocessable Entity",
      );
    }

    const result = await withEvaluationLog("SCORING", candidate.id, () => engine.computeAggregate(candidate));
    res.status(200).json(result);
  }),
);
