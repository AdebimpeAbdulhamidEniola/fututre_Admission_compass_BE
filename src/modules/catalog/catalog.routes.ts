import { Router } from "express";

import { asyncHandler } from "../../lib/async-handler.js";
import * as catalogService from "./catalog.service.js";

export const catalogRouter = Router();

// All public — no auth required, matches the "explore before you register" flow.

catalogRouter.get(
  "/universities",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await catalogService.listUniversities());
  }),
);

catalogRouter.get(
  "/universities/:id/courses",
  asyncHandler(async (req, res) => {
    res.status(200).json(await catalogService.listCoursesForUniversity(req.params.id));
  }),
);

catalogRouter.get(
  "/universities/:id/scoring-policy",
  asyncHandler(async (req, res) => {
    res.status(200).json(await catalogService.getScoringPolicy(req.params.id));
  }),
);

catalogRouter.get(
  "/universities/:id/catchment-rule",
  asyncHandler(async (req, res) => {
    res.status(200).json(await catalogService.getCatchmentRule(req.params.id));
  }),
);

catalogRouter.get(
  "/courses/:id/requirements",
  asyncHandler(async (req, res) => {
    res.status(200).json(await catalogService.getCourseRequirements(req.params.id));
  }),
);
