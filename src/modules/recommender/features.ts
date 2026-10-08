import type { CourseEvaluation } from "../assessment/engine.js";

// Fixed category orders so a feature index means the same thing in every trained model.
const UNIVERSITY_CODES = ["UI", "UNILAG", "OAU", "FUTA", "FUNAAB", "FUOYE"];
const FACULTIES = [
  "Clinical Sciences",
  "Law",
  "Engineering & Technology",
  "Arts",
  "Social & Management Sciences",
  "Science",
  "Agriculture",
  "Logistics & Innovation Technology",
];
const STATUS_CODES = { MERIT: 0, CATCHMENT: 1, ELDS: 2 } as const;

export const FEATURE_NAMES = [
  "utmePercent",
  "postUtmePercent",
  "oLevelPercent",
  "aggregate",
  "cutOff",
  "margin",
  "catchmentStatus",
  "cutOffBasis",
  "oLevelSittings",
  "university",
  "faculty",
] as const;

/**
 * One row of model input for a (candidate, course) pair. Every value is rounded to a whole number:
 * ml-cart tries a split between every pair of neighbouring values, so coarse values keep training
 * fast without losing anything meaningful at this scale. A raw-JAMB (UTME-basis) cut-off and margin
 * are divided by 4 to sit on the same 0–100 scale as an aggregate one.
 */
export function toFeatures(evaluation: CourseEvaluation, oLevelSittings: number): number[] {
  const scale = evaluation.cutOff.basis === "UTME" ? 0.25 : 1;
  return [
    Math.round(evaluation.utmePercent),
    evaluation.postUtmePercent === null ? -1 : Math.round(evaluation.postUtmePercent),
    Math.round(evaluation.oLevelPercent),
    Math.round(evaluation.aggregate),
    Math.round(evaluation.cutOff.value * scale),
    Math.round(evaluation.margin * scale),
    STATUS_CODES[evaluation.status],
    evaluation.cutOff.basis === "UTME" ? 1 : 0,
    oLevelSittings,
    UNIVERSITY_CODES.indexOf(evaluation.course.university.code),
    FACULTIES.indexOf(evaluation.course.faculty),
  ];
}

/** The cut-off margin on the 0–100 scale, whichever basis the course is judged on. */
export function normalizedMargin(evaluation: CourseEvaluation): number {
  return evaluation.cutOff.basis === "UTME" ? evaluation.margin / 4 : evaluation.margin;
}
