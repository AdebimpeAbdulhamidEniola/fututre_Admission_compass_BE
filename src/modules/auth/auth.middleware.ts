import type { NextFunction, Request, Response } from "express";

import { forbidden, unauthorized } from "../../lib/errors.js";
import { verifyAccessToken } from "../../lib/jwt.js";
import { getAuthUserById } from "./auth.service.js";

/** Verifies the Bearer token and attaches the authenticated user to req.user. 401s otherwise. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized("Missing or malformed Authorization header");
    }
    const token = header.slice("Bearer ".length);

    let payload: ReturnType<typeof verifyAccessToken>;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw unauthorized("Invalid or expired token");
    }

    req.user = await getAuthUserById(payload.sub);
    next();
  } catch (err) {
    next(err);
  }
}

/** Must run after requireAuth. 403s unless the authenticated user is an ADMIN. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    next(forbidden("This action requires an administrator account"));
    return;
  }
  next();
}
