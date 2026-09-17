import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import * as candidatesService from "./candidates.service.js";
import { createProfileSchema, updateProfileSchema } from "./candidates.schema.js";

export const candidatesRouter = Router();

candidatesRouter.post(
  "/candidates/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(createProfileSchema, req.body);
    const profile = await candidatesService.createOrReplaceProfile(req.user!.id, input);
    res.status(201).json(profile);
  }),
);

candidatesRouter.get(
  "/candidates/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await candidatesService.getProfileByUserId(req.user!.id);
    res.status(200).json(profile);
  }),
);

candidatesRouter.patch(
  "/candidates/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(updateProfileSchema, req.body);
    const profile = await candidatesService.updateProfile(req.user!.id, input);
    res.status(200).json(profile);
  }),
);
