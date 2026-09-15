import type { AuthUser } from "../modules/auth/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth once the Bearer token has been verified. */
      user?: AuthUser;
    }
  }
}

export {};
