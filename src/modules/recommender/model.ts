/**
 * The ml-cart Decision Tree behind the course recommender (Stage 8; thesis Objective 3).
 *
 * Trained on the synthetic dataset in synthetic-data.ts, 80/20 train/test split. The trained tree,
 * its held-out test metrics (accuracy/precision/recall/confusion matrix — what the admin metrics
 * dashboard shows) and how many training rows each course had are saved together as one JSON
 * file. `npm run ml:train` (re)builds it; if it's missing when the server needs it, the server
 * trains one from the current catalog and saves it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { env } from "../../config/env.js";
import { loadCatalog } from "../assessment/engine.js";
import { FEATURE_NAMES } from "./features.js";
import { buildTrainingRows, generateCandidates, shuffled, type TrainingRow } from "./synthetic-data.js";

const MODEL_VERSION = 1;
const TEST_SHARE = 0.2;
const TREE_OPTIONS = { gainFunction: "gini", maxDepth: 8, minNumSamples: 10 } as const;

interface DecisionTreeClassifier {
  train(features: number[][], labels: number[]): void;
  predict(features: number[][]): number[];
  toJSON(): unknown;
}

interface DecisionTreeClassifierClass {
  new (options: typeof TREE_OPTIONS): DecisionTreeClassifier;
  load(model: unknown): DecisionTreeClassifier;
}

/**
 * ml-cart ships no TypeScript types; importing it through a variable keeps the compiler from
 * looking for them, and the shapes above describe the small part of its API used here. Works with
 * either its ESM (named export) or CommonJS (default export object) build.
 */
async function loadMlCart(): Promise<DecisionTreeClassifierClass> {
  const moduleName = "ml-cart";
  const mod = (await import(moduleName)) as {
    DecisionTreeClassifier?: DecisionTreeClassifierClass;
    default?: { DecisionTreeClassifier?: DecisionTreeClassifierClass };
  };
  const DecisionTreeClassifier = mod.DecisionTreeClassifier ?? mod.default?.DecisionTreeClassifier;
  if (!DecisionTreeClassifier) throw new Error("ml-cart did not export DecisionTreeClassifier");
  return DecisionTreeClassifier;
}

export interface RecommenderMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  confusionMatrix: { predicted: "MATCH" | "NO_MATCH"; actual: "MATCH" | "NO_MATCH"; count: number }[];
}

export interface SavedModel {
  version: number;
  trainedAt: string;
  featureNames: readonly string[];
  dataset: { candidates: number; rows: number; trainRows: number; testRows: number };
  metrics: RecommenderMetrics;
  /** Training rows per course — few rows means a less trustworthy estimate for that course. */
  rowsPerCourse: Record<string, number>;
  tree: unknown;
}

export interface LoadedModel {
  saved: SavedModel;
  /** Probability (0–1) that a candidate with these features is admitted. */
  predictProbability(features: number[]): number;
}

function evaluate(predicted: number[], actual: number[]): RecommenderMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  predicted.forEach((p, i) => {
    if (p === 1 && actual[i] === 1) tp++;
    else if (p === 1) fp++;
    else if (actual[i] === 1) fn++;
    else tn++;
  });
  const ratio = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 10000) / 10000);
  return {
    accuracy: ratio(tp + tn, predicted.length),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    confusionMatrix: [
      { predicted: "MATCH", actual: "MATCH", count: tp },
      { predicted: "MATCH", actual: "NO_MATCH", count: fp },
      { predicted: "NO_MATCH", actual: "MATCH", count: fn },
      { predicted: "NO_MATCH", actual: "NO_MATCH", count: tn },
    ],
  };
}

/** Reads P(class 1) off a leaf's class distribution — an ml-matrix row, or a plain [[p0, p1]] array. */
function classOneProbability(distribution: unknown): number | null {
  const asRows =
    distribution !== null &&
    typeof distribution === "object" &&
    typeof (distribution as { to2DArray?: unknown }).to2DArray === "function"
      ? (distribution as { to2DArray(): number[][] }).to2DArray()
      : distribution;
  if (!Array.isArray(asRows)) return null;
  const row = (Array.isArray(asRows[0]) ? asRows[0] : asRows) as unknown[];
  if (!row.every((v) => typeof v === "number")) return null;
  const values = row as number[];
  const total = values.reduce((sum, v) => sum + v, 0);
  // A leaf where every training row was class 0 has a single-column distribution.
  return total > 0 ? (values[1] ?? 0) / total : null;
}

function wrap(classifier: DecisionTreeClassifier, saved: SavedModel): LoadedModel {
  // ml-cart's predict() returns only the majority class; walking the tree with its root node's
  // classify() gives the leaf's class distribution instead, which is the match probability.
  const root = (classifier as { root?: { classify?: (row: number[]) => unknown } }).root;
  return {
    saved,
    predictProbability(features) {
      const probability = root?.classify ? classOneProbability(root.classify(features)) : null;
      return probability ?? (classifier.predict([features])[0] === 1 ? 1 : 0);
    },
  };
}

function countRowsPerCourse(rows: TrainingRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.courseId] = (counts[row.courseId] ?? 0) + 1;
  return counts;
}

export async function trainModel() {
  const DecisionTreeClassifier = await loadMlCart();
  const catalog = await loadCatalog();
  const candidates = generateCandidates();
  const rows = shuffled(buildTrainingRows(catalog, candidates));
  if (rows.length < 50) {
    throw new Error(`Only ${rows.length} training rows could be built — is the catalog seeded?`);
  }

  const testCount = Math.round(rows.length * TEST_SHARE);
  const test = rows.slice(0, testCount);
  const train = rows.slice(testCount);

  const classifier = new DecisionTreeClassifier(TREE_OPTIONS);
  classifier.train(
    train.map((r) => r.features),
    train.map((r) => r.label),
  );
  const metrics = evaluate(
    classifier.predict(test.map((r) => r.features)),
    test.map((r) => r.label),
  );

  const saved: SavedModel = {
    version: MODEL_VERSION,
    trainedAt: new Date().toISOString(),
    featureNames: FEATURE_NAMES,
    dataset: { candidates: candidates.length, rows: rows.length, trainRows: train.length, testRows: test.length },
    metrics,
    rowsPerCourse: countRowsPerCourse(rows),
    // A JSON round-trip turns ml-matrix objects inside the tree into plain arrays.
    tree: JSON.parse(JSON.stringify(classifier.toJSON())),
  };
  return { model: wrap(classifier, saved), candidates, rows };
}

function modelPath() {
  return resolve(process.cwd(), env.recommenderModelPath);
}

export async function saveModel(saved: SavedModel) {
  const path = modelPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(saved));
  return path;
}

async function readSavedModel(): Promise<SavedModel | null> {
  try {
    const saved = JSON.parse(await readFile(modelPath(), "utf8")) as SavedModel;
    return saved.version === MODEL_VERSION ? saved : null;
  } catch {
    return null;
  }
}

let modelPromise: Promise<LoadedModel> | null = null;

async function loadOrTrain(): Promise<LoadedModel> {
  const saved = await readSavedModel();
  if (saved) {
    const DecisionTreeClassifier = await loadMlCart();
    return wrap(DecisionTreeClassifier.load(saved.tree), saved);
  }
  const { model } = await trainModel();
  // Best effort: a read-only filesystem just means retraining after each restart.
  await saveModel(model.saved).catch(() => undefined);
  return model;
}

/** The recommender model, loaded (or trained) once per process. */
export function getModel(): Promise<LoadedModel> {
  modelPromise ??= loadOrTrain().catch((err: unknown) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

/** Drops the cached model so the next request reloads it, e.g. after `npm run ml:train`. */
export function resetModelCache() {
  modelPromise = null;
}
