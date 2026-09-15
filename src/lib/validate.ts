import type { ZodSchema } from "zod";

import { badRequest } from "./errors.js";

/** Parses `data` against `schema`, throwing a 400 ApiError with one message per validation issue on failure. */
export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    throw badRequest(messages);
  }
  return result.data;
}
