import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { candidatePayloadSchema } from "../assessment/candidate-profile.schema.js";
import * as assessmentsService from "./assessments.service.js";

export const assessmentsRouter = Router();

assessmentsRouter.post(
  "/assessments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { candidate } = parseOrThrow(candidatePayloadSchema, req.body);
    const report = await assessmentsService.createAssessment(req.user!.id, candidate);
    res.status(201).json(report);
  }),
);

assessmentsRouter.get(
  "/assessments",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await assessmentsService.listAssessments(req.user!.id));
  }),
);

assessmentsRouter.get(
  "/assessments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await assessmentsService.getAssessment(req.user!.id, req.params.id));
  }),
);
