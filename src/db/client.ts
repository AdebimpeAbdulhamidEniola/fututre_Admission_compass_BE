import { PrismaClient } from "@prisma/client";

import { env } from "../config/env.js";

// A single shared PrismaClient instance, reused across the app (Prisma's own recommendation —
// creating one per request exhausts the connection pool).
export const prisma = new PrismaClient({
  log: env.isProduction ? ["error", "warn"] : ["query", "error", "warn"],
});
