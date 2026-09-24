import type { EvaluationModule, EvaluationOutcome } from "@prisma/client";

import { prisma } from "../../db/client.js";

// Not a fact about the world — a configured target, same as the quota-percent fallbacks used
// elsewhere in this codebase. Change here if the project sets a different SLA.
const LATENCY_TARGET_MS = 500;

const HISTOGRAM_BUCKET_SIZE = 10;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AdminMetrics {
  totalCandidates: number;
  assessmentsRun: number;
  eligibilityPassRate: number;
  averageAggregate: number;
  byUniversity: { code: string; assessments: number; passRate: number }[];
  precision: number;
  recall: number;
  accuracy: number;
  meanResponseLatencyMs: number;
  latencyTargetMs: number;
  latencyTimeSeries: {
    date: string;
    verificationMs: number;
    scoringMs: number;
    catchmentMs: number;
    recommendationMs: number;
  }[];
  recommenderConfusionMatrix: { predicted: "MATCH" | "NO_MATCH"; actual: "MATCH" | "NO_MATCH"; count: number }[];
  aggregateScoreHistogram: { bucket: string; count: number }[];
}

export async function getMetrics(): Promise<AdminMetrics> {
  const [totalCandidates, reports, events] = await Promise.all([
    prisma.candidateProfile.count(),
    prisma.assessmentReport.findMany({
      select: {
        verification: true,
        score: true,
        course: { select: { university: { select: { code: true } } } },
      },
    }),
    prisma.evaluationEvent.findMany({
      select: { module: true, outcome: true, latencyMs: true, timestamp: true },
    }),
  ]);

  const assessmentsRun = reports.length;

  const eligibleCount = reports.filter((r) => {
    const v = r.verification as unknown as { eligible?: boolean } | null;
    return v?.eligible === true;
  }).length;
  const eligibilityPassRate = assessmentsRun > 0 ? round((eligibleCount / assessmentsRun) * 100) : 0;

  const aggregates = reports
    .map((r) => (r.score as unknown as { aggregate?: number } | null)?.aggregate)
    .filter((a): a is number => typeof a === "number");
  const averageAggregate =
    aggregates.length > 0 ? round(aggregates.reduce((s, a) => s + a, 0) / aggregates.length) : 0;

  const byUniversityMap = new Map<string, { assessments: number; eligible: number }>();
  for (const r of reports) {
    const code = r.course.university.code;
    const entry = byUniversityMap.get(code) ?? { assessments: 0, eligible: 0 };
    entry.assessments += 1;
    const v = r.verification as unknown as { eligible?: boolean } | null;
    if (v?.eligible === true) entry.eligible += 1;
    byUniversityMap.set(code, entry);
  }
  const byUniversity = [...byUniversityMap.entries()].map(([code, { assessments, eligible }]) => ({
    code,
    assessments,
    passRate: assessments > 0 ? round((eligible / assessments) * 100) : 0,
  }));

  const meanResponseLatencyMs =
    events.length > 0 ? round(events.reduce((s, e) => s + e.latencyMs, 0) / events.length) : 0;

  const byDateModule = new Map<string, Record<EvaluationModule, number[]>>();
  for (const e of events) {
    const date = dateKey(e.timestamp);
    const entry = byDateModule.get(date) ?? {
      VERIFICATION: [],
      SCORING: [],
      CATCHMENT: [],
      RECOMMENDATION: [],
    };
    entry[e.module].push(e.latencyMs);
    byDateModule.set(date, entry);
  }
  const avg = (arr: number[]) => (arr.length > 0 ? round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0);
  const latencyTimeSeries = [...byDateModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byModule]) => ({
      date,
      verificationMs: avg(byModule.VERIFICATION),
      scoringMs: avg(byModule.SCORING),
      catchmentMs: avg(byModule.CATCHMENT),
      recommendationMs: avg(byModule.RECOMMENDATION),
    }));

  const histogramBuckets = new Map<string, number>();
  for (const a of aggregates) {
    const bucketStart = Math.min(90, Math.floor(a / HISTOGRAM_BUCKET_SIZE) * HISTOGRAM_BUCKET_SIZE);
    const label = `${bucketStart}-${bucketStart + HISTOGRAM_BUCKET_SIZE}`;
    histogramBuckets.set(label, (histogramBuckets.get(label) ?? 0) + 1);
  }
  const aggregateScoreHistogram = [...histogramBuckets.entries()]
    .sort(([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
    .map(([bucket, count]) => ({ bucket, count }));

  return {
    totalCandidates,
    assessmentsRun,
    eligibilityPassRate,
    averageAggregate,
    byUniversity,
    // The ML Decision Tree recommender (see docs/backend-implementation-plan.md, Stage 8) isn't
    // built yet — recommendCourses() today is deterministic arithmetic, not a trained classifier,
    // so there's no predicted-vs-actual ground truth to compute precision/recall/accuracy from.
    // Honest zeros/empty, not a fabricated number, until that module exists and is evaluated.
    precision: 0,
    recall: 0,
    accuracy: 0,
    meanResponseLatencyMs,
    latencyTargetMs: LATENCY_TARGET_MS,
    latencyTimeSeries,
    recommenderConfusionMatrix: [],
    aggregateScoreHistogram,
  };
}

export async function listLogs() {
  const logs = await prisma.adminLogEntry.findMany({
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { fullName: true, email: true } } },
  });
  return logs.map((l) => ({
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    actor: l.actor.fullName || l.actor.email,
    action: l.action,
    entity: l.entity,
    summary: l.summary,
  }));
}

export interface EvaluationEventFilters {
  module?: EvaluationModule;
  outcome?: EvaluationOutcome;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export async function listEvaluationEvents(filters: EvaluationEventFilters) {
  const where = {
    ...(filters.module ? { module: filters.module } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          timestamp: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.evaluationEvent.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.evaluationEvent.count({ where }),
  ]);

  return {
    items: items.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      candidateId: e.candidateId,
      module: e.module,
      outcome: e.outcome,
      latencyMs: e.latencyMs,
    })),
    total,
  };
}

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
