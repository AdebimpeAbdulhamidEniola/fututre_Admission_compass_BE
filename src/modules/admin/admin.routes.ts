import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../lib/async-handler.js";
import { badRequest } from "../../lib/errors.js";
import { parseOrThrow } from "../../lib/validate.js";
import { requireAdmin, requireAuth } from "../auth/auth.middleware.js";
import * as adminService from "./admin.service.js";
import * as importService from "./import.service.js";
import { universityImportSchema } from "./import.schemas.js";
import * as metricsService from "./metrics.service.js";
import {
  catchmentRuleSchema,
  catchmentRuleUpdateSchema,
  courseSchema,
  courseUpdateSchema,
  requirementSchema,
  requirementUpdateSchema,
  scoringPolicySchema,
  scoringPolicyUpdateSchema,
  universitySchema,
  universityUpdateSchema,
} from "./admin.schemas.js";

export const adminRouter = Router();

adminRouter.use("/admin/universities", requireAuth, requireAdmin);
adminRouter.use("/admin/courses", requireAuth, requireAdmin);
adminRouter.use("/admin/requirements", requireAuth, requireAdmin);
adminRouter.use("/admin/scoring-policies", requireAuth, requireAdmin);
adminRouter.use("/admin/catchment-rules", requireAuth, requireAdmin);
adminRouter.use("/admin/metrics", requireAuth, requireAdmin);
adminRouter.use("/admin/logs", requireAuth, requireAdmin);
adminRouter.use("/admin/evaluation-events", requireAuth, requireAdmin);
adminRouter.use("/admin/import", requireAuth, requireAdmin);

// --- Excel import (one university's rules + optional course cut-offs) ---------------------------

adminRouter.post(
  "/admin/import/university/preview",
  asyncHandler(async (req, res) => {
    const sheets = parseOrThrow(universityImportSchema, req.body);
    res.status(200).json(await importService.previewImport(sheets));
  }),
);
adminRouter.post(
  "/admin/import/university",
  asyncHandler(async (req, res) => {
    const sheets = parseOrThrow(universityImportSchema, req.body);
    res.status(200).json(await importService.applyImport(req.user!.id, sheets));
  }),
);

// --- Universities --------------------------------------------------------------------------

adminRouter.get(
  "/admin/universities",
  asyncHandler(async (_req, res) => res.status(200).json(await adminService.listUniversities())),
);
adminRouter.post(
  "/admin/universities",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(universitySchema, req.body);
    res.status(201).json(await adminService.createUniversity(req.user!.id, input));
  }),
);
adminRouter.patch(
  "/admin/universities/:id",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(universityUpdateSchema, req.body);
    res.status(200).json(await adminService.updateUniversity(req.user!.id, req.params.id, input));
  }),
);
adminRouter.delete(
  "/admin/universities/:id",
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.deleteUniversity(req.user!.id, req.params.id));
  }),
);

// --- Courses ---------------------------------------------------------------------------------

adminRouter.get(
  "/admin/courses",
  asyncHandler(async (_req, res) => res.status(200).json(await adminService.listCourses())),
);
adminRouter.post(
  "/admin/courses",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(courseSchema, req.body);
    res.status(201).json(await adminService.createCourse(req.user!.id, input));
  }),
);
adminRouter.patch(
  "/admin/courses/:id",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(courseUpdateSchema, req.body);
    res.status(200).json(await adminService.updateCourse(req.user!.id, req.params.id, input));
  }),
);
adminRouter.delete(
  "/admin/courses/:id",
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.deleteCourse(req.user!.id, req.params.id));
  }),
);

// --- Admission requirements ------------------------------------------------------------------

adminRouter.get(
  "/admin/requirements",
  asyncHandler(async (_req, res) => res.status(200).json(await adminService.listRequirements())),
);
adminRouter.post(
  "/admin/requirements",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(requirementSchema, req.body);
    res.status(201).json(await adminService.createRequirement(req.user!.id, input));
  }),
);
adminRouter.patch(
  "/admin/requirements/:id",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(requirementUpdateSchema, req.body);
    res.status(200).json(await adminService.updateRequirement(req.user!.id, req.params.id, input));
  }),
);
adminRouter.delete(
  "/admin/requirements/:id",
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.deleteRequirement(req.user!.id, req.params.id));
  }),
);

// --- Scoring policies --------------------------------------------------------------------------

adminRouter.get(
  "/admin/scoring-policies",
  asyncHandler(async (_req, res) => res.status(200).json(await adminService.listScoringPolicies())),
);
adminRouter.post(
  "/admin/scoring-policies",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(scoringPolicySchema, req.body);
    res.status(201).json(await adminService.createScoringPolicy(req.user!.id, input));
  }),
);
adminRouter.patch(
  "/admin/scoring-policies/:id",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(scoringPolicyUpdateSchema, req.body);
    res
      .status(200)
      .json(await adminService.updateScoringPolicy(req.user!.id, req.params.id, input));
  }),
);
adminRouter.delete(
  "/admin/scoring-policies/:id",
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.deleteScoringPolicy(req.user!.id, req.params.id));
  }),
);

// --- Catchment rules --------------------------------------------------------------------------

adminRouter.get(
  "/admin/catchment-rules",
  asyncHandler(async (_req, res) => res.status(200).json(await adminService.listCatchmentRules())),
);
adminRouter.post(
  "/admin/catchment-rules",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(catchmentRuleSchema, req.body);
    res.status(201).json(await adminService.createCatchmentRule(req.user!.id, input));
  }),
);
adminRouter.patch(
  "/admin/catchment-rules/:id",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(catchmentRuleUpdateSchema, req.body);
    res
      .status(200)
      .json(await adminService.updateCatchmentRule(req.user!.id, req.params.id, input));
  }),
);
adminRouter.delete(
  "/admin/catchment-rules/:id",
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.deleteCatchmentRule(req.user!.id, req.params.id));
  }),
);

// --- Metrics / evaluation dashboard (Stage 6) --------------------------------------------------

adminRouter.get(
  "/admin/metrics",
  asyncHandler(async (_req, res) => res.status(200).json(await metricsService.getMetrics())),
);

adminRouter.get(
  "/admin/logs",
  asyncHandler(async (_req, res) => res.status(200).json(await metricsService.listLogs())),
);

const evaluationEventQuerySchema = z.object({
  module: z.enum(["VERIFICATION", "SCORING", "CATCHMENT", "RECOMMENDATION"]).optional(),
  outcome: z.enum(["SUCCESS", "FAILURE"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminRouter.get(
  "/admin/evaluation-events",
  asyncHandler(async (req, res) => {
    const result = evaluationEventQuerySchema.safeParse(req.query);
    if (!result.success) {
      throw badRequest(
        result.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`),
      );
    }
    res.status(200).json(await metricsService.listEvaluationEvents(result.data));
  }),
);
