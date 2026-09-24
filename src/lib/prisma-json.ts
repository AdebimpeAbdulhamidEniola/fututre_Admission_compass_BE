import type { Prisma } from "@prisma/client";

/** Prisma's Json fields come back as JsonValue (string | number | ... | null) — narrow to a flat number map, or undefined if not an object (matches the frontend's optional Record<string, number> fields). */
export function toNumberMap(value: Prisma.JsonValue | null | undefined): Record<string, number> | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, number>;
}
