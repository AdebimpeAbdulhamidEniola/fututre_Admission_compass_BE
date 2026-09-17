import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { candidatePayloadSchema } from "./candidate-profile.schema.js";
import * as engine from "./engine.js";
import { withEvaluationLog } from "./evaluation-logger.js";

export const catchmentRouter = Router();

catchmentRouter.post(
  "/catchment/classify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { candidate } = parseOrThrow(candidatePayloadSchema, req.body);
    const result = await withEvaluationLog("CATCHMENT", candidate.id, () =>
      engine.classifyCatchment(candidate),
    );
    res.status(200).json(result);
  }),
);
