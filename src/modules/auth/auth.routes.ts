import { Router } from "express";

import { asyncHandler } from "../../lib/async-handler.js";
import { parseOrThrow } from "../../lib/validate.js";
import { requireAuth } from "./auth.middleware.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import * as authService from "./auth.service.js";

export const authRouter = Router();

authRouter.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(registerSchema, req.body);
    const session = await authService.register(input);
    res.status(201).json(session);
  }),
);

authRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);
    const session = await authService.login(input);
    res.status(200).json(session);
  }),
);

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.status(200).json(req.user);
});
