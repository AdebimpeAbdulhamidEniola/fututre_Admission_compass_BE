/**
 * `npm run ml:evaluate -- <file.csv>` — tests the saved Decision Tree on an unseen dataset of real
 * (or independently collected) candidates whose admission outcome is known, instead of on the
 * synthetic test split it was trained alongside.
 *
 * Each row is checked with the live engine (eligibility, the course's own university formula,
 * catchment and cut-off), turned into the same features the model was trained on, and predicted
 * admitted when the model's probability is >= 0.5. Prints accuracy/precision/recall and a
 * confusion matrix for the model, plus the same metrics for a rule-only baseline ("admitted if the
 * score meets the cut-off"), and saves everything next to the model file.
 *
 * CSV columns (header row required; see data/unseen-dataset-template.csv):
 *   id, university, course, stateOfOrigin, schoolLocationState, utmeScore, postUtmeScore,
 *   utmeSubjects, oLevelResults, oLevelSittings, admitted
 * - university: UI | UNILAG | OAU | FUTA | FUNAAB | FUOYE; course: exact course name as in the app
 * - postUtmeScore: raw score as entered in the app, blank if none
 * - utmeSubjects: the 3 subjects besides Use of English, separated by ";"
 * - oLevelResults: "Subject:Grade" pairs separated by ";" (list a subject twice for two sittings)
 * - oLevelSittings: 1 or 2 (blank = 1); admitted: 1/0, yes/no or true/false
 */
/* eslint-disable no-console -- CLI output */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { OLevelGrade } from "@prisma/client";

import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import type { CandidateProfileInput } from "../assessment/candidate-profile.schema.js";
import { evaluateCourse, loadCatalog } from "../assessment/engine.js";
import { toFeatures } from "./features.js";
import { getModel, scoreMetrics } from "./model.js";

const GRADES = new Set(["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"]);

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas/newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseAdmitted(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (["1", "yes", "true", "admitted"].includes(v)) return 1;
  if (["0", "no", "false", "not admitted"].includes(v)) return 0;
  return null;
}

interface Skipped {
  id: string;
  reason: string;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run ml:evaluate -- <path/to/unseen-dataset.csv>");
    process.exitCode = 1;
    return;
  }

  const [rows, catalog, model] = await Promise.all([
    readFile(resolve(process.cwd(), file), "utf8").then(parseCsv),
    loadCatalog(),
    getModel(),
  ]);
  const [header, ...records] = rows;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const required = ["id", "university", "course", "stateOfOrigin", "utmeScore", "utmeSubjects", "oLevelResults", "admitted"];
  const missing = required.filter((name) => col(name) === -1);
  if (missing.length > 0) {
    throw new Error(`CSV is missing column(s): ${missing.join(", ")}`);
  }
  const get = (record: string[], name: string) => (col(name) === -1 ? "" : (record[col(name)] ?? "").trim());

  const predicted: number[] = [];
  const ruleBaseline: number[] = [];
  const actual: number[] = [];
  const skipped: Skipped[] = [];
  const results: { id: string; course: string; probability: number; predicted: number; actual: number }[] = [];

  for (const record of records) {
    const id = get(record, "id") || `row-${results.length + skipped.length + 1}`;
    const admitted = parseAdmitted(get(record, "admitted"));
    if (admitted === null) {
      skipped.push({ id, reason: "admitted is not 1/0, yes/no or true/false" });
      continue;
    }
    const code = get(record, "university").toUpperCase();
    const courseName = get(record, "course").toLowerCase();
    const course = catalog.courses.find(
      (c) => c.university.code === code && c.name.toLowerCase() === courseName,
    );
    if (!course) {
      skipped.push({ id, reason: `no course "${get(record, "course")}" at ${code}` });
      continue;
    }

    const oLevelResults = get(record, "oLevelResults")
      .split(";")
      .map((pair) => pair.split(":").map((part) => part.trim()))
      .filter(([subject, grade]) => subject && grade);
    const badGrade = oLevelResults.find(([, grade]) => !GRADES.has(grade.toUpperCase()));
    if (badGrade) {
      skipped.push({ id, reason: `invalid O'Level grade "${badGrade[1]}"` });
      continue;
    }
    const utmeScore = Number(get(record, "utmeScore"));
    const postUtmeRaw = get(record, "postUtmeScore");
    const postUtmeScore = postUtmeRaw === "" ? null : Number(postUtmeRaw);
    if (!Number.isFinite(utmeScore) || (postUtmeScore !== null && !Number.isFinite(postUtmeScore))) {
      skipped.push({ id, reason: "utmeScore/postUtmeScore is not a number" });
      continue;
    }

    const candidate: CandidateProfileInput = {
      id,
      fullName: id,
      email: `${id}@example.com`,
      stateOfOrigin: get(record, "stateOfOrigin"),
      lga: "—",
      schoolLocationState: get(record, "schoolLocationState") || get(record, "stateOfOrigin"),
      utmeScore,
      postUtmeScore,
      utmeSubjects: ["Use of English", ...get(record, "utmeSubjects").split(";").map((s) => s.trim()).filter(Boolean)],
      oLevelResults: oLevelResults.map(([subject, grade]) => ({ subject, grade: grade.toUpperCase() as OLevelGrade })),
      oLevelSittings: get(record, "oLevelSittings") === "2" ? 2 : 1,
      targetCourseId: course.id,
      targetUniversityId: course.universityId,
    };

    const policy = catalog.policyByUniversityId.get(course.universityId);
    const postUtmePercent = postUtmeScore !== null && policy ? (postUtmeScore / policy.postUtmeMaxScore) * 100 : null;
    const evaluation = evaluateCourse(candidate, postUtmePercent, course, catalog);
    if (!evaluation) {
      // The model only ranks courses the candidate qualifies for, so it has nothing to predict here.
      skipped.push({ id, reason: "not eligible, no Post-UTME score where required, or no cut-off for this course" });
      continue;
    }

    const probability = model.predictProbability(toFeatures(evaluation, candidate.oLevelSittings));
    const prediction = probability >= 0.5 ? 1 : 0;
    predicted.push(prediction);
    ruleBaseline.push(evaluation.meetsCutOff ? 1 : 0);
    actual.push(admitted);
    results.push({ id, course: `${code} ${course.name}`, probability: Math.round(probability * 100) / 100, predicted: prediction, actual: admitted });
  }

  if (actual.length === 0) {
    console.log("No row could be evaluated. Skipped rows:");
    console.table(skipped);
    return;
  }

  const modelMetrics = scoreMetrics(predicted, actual);
  const baselineMetrics = scoreMetrics(ruleBaseline, actual);
  console.log(`Rows read: ${records.length} · evaluated: ${actual.length} · skipped: ${skipped.length}`);
  console.log(`Admitted in this dataset: ${actual.filter((a) => a === 1).length} of ${actual.length}`);
  console.log(
    `Decision Tree  — accuracy ${modelMetrics.accuracy}, precision ${modelMetrics.precision}, recall ${modelMetrics.recall}`,
  );
  console.table(modelMetrics.confusionMatrix);
  console.log(
    `Rule baseline (score meets cut-off) — accuracy ${baselineMetrics.accuracy}, precision ${baselineMetrics.precision}, recall ${baselineMetrics.recall}`,
  );
  if (skipped.length > 0) {
    console.log("Skipped rows:");
    console.table(skipped);
  }

  const outPath = join(dirname(resolve(process.cwd(), env.recommenderModelPath)), "unseen-evaluation.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        source: file,
        modelTrainedAt: model.saved.trainedAt,
        counts: { rows: records.length, evaluated: actual.length, skipped: skipped.length },
        model: modelMetrics,
        ruleBaseline: baselineMetrics,
        results,
        skipped,
      },
      null,
      2,
    ),
  );
  console.log(`Saved to ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
