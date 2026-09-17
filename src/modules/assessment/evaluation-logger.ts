import type { EvaluationModule } from "@prisma/client";

import { prisma } from "../../db/client.js";

/**
 * Wraps an engine call with an EvaluationEvent (module, outcome, latencyMs) as required by
 * the implementation plan's Stage 4 spec — feeds the Stage 6 metrics dashboard later.
 * Logging failures never mask the underlying result/error.
 */
export async function withEvaluationLog<T>(
  module: EvaluationModule,
  candidateId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await prisma.evaluationEvent
      .create({
        data: { candidateId, module, outcome: "SUCCESS", latencyMs: Date.now() - startedAt },
      })
      .catch(() => undefined);
    return result;
  } catch (err) {
    await prisma.evaluationEvent
      .create({
        data: { candidateId, module, outcome: "FAILURE", latencyMs: Date.now() - startedAt },
      })
      .catch(() => undefined);
    throw err;
  }
}
