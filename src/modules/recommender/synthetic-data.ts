/**
 * Synthetic training data for the Decision Tree recommender (thesis §1.4: a synthetic dataset of
 * mock UTME and O'Level candidate profiles, benchmarked against historical admission cut-offs —
 * 2,000 profiles here). No real JAMB data is available, so each profile is generated, checked against real
 * courses from the seeded catalog with the same engine the live app uses, and labelled
 * admitted/not admitted by its margin over that course's published (historical) cut-off, with
 * random noise standing in for the year-to-year competition a cut-off alone doesn't capture.
 *
 * Deterministic: the same seed and catalog always give the same dataset, so a retrained model is
 * reproducible.
 */
import type { OLevelGrade } from "@prisma/client";

import type { CandidateProfileInput } from "../assessment/candidate-profile.schema.js";
import { type Catalog, evaluateCourse } from "../assessment/engine.js";
import { normalizedMargin, toFeatures } from "./features.js";

export const SYNTHETIC_CANDIDATES = 2000;
// Two courses each keeps the training set (~4,000 rows) quick for ml-cart to fit.
const COURSES_PER_CANDIDATE = 2;
const MAX_ATTEMPTS_PER_CANDIDATE = 40;
const DEFAULT_SEED = 20260;

/**
 * How sharply admission odds change around the cut-off: a candidate 2.5 points above it is
 * admitted ~73% of the time, 2.5 below ~27%. An assumption standing in for real admission
 * outcomes, not a measured figure.
 */
const MARGIN_SPREAD = 2.5;

const GRADES: OLevelGrade[] = ["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"];

const SOUTH_WEST = ["Lagos", "Ogun", "Oyo", "Osun", "Ondo", "Ekiti"];
const ELDS_SAMPLE = ["Kwara", "Kogi", "Kano", "Benue", "Ebonyi", "Cross River", "Kaduna", "Rivers"];
const OTHER_STATES = ["Edo", "Delta", "Anambra", "Enugu", "Imo", "Abia", "Akwa Ibom", "Plateau", "FCT (Abuja)"];

interface Stream {
  utme: string[][];
  oLevel: string[];
  extraOLevel: string[];
}

const STREAMS: { weight: number; stream: Stream }[] = [
  {
    weight: 0.5,
    stream: {
      utme: [
        ["Biology", "Chemistry", "Physics"],
        ["Mathematics", "Physics", "Chemistry"],
        ["Mathematics", "Chemistry", "Biology"],
        ["Chemistry", "Biology", "Agricultural Science"],
      ],
      oLevel: ["English Language", "Mathematics", "Physics", "Chemistry", "Biology"],
      extraOLevel: ["Agricultural Science", "Further Mathematics", "Geography", "Civic Education", "Technical Drawing"],
    },
  },
  {
    weight: 0.2,
    stream: {
      utme: [
        ["Literature in English", "Government", "Christian Religious Studies"],
        ["Literature in English", "Government", "History"],
        ["Literature in English", "Yoruba", "Government"],
      ],
      oLevel: ["English Language", "Mathematics", "Literature in English", "Government"],
      extraOLevel: ["Christian Religious Studies", "Yoruba", "Economics", "Civic Education", "Geography"],
    },
  },
  {
    weight: 0.3,
    stream: {
      utme: [
        ["Mathematics", "Economics", "Government"],
        ["Mathematics", "Economics", "Commerce"],
        ["Mathematics", "Economics", "Geography"],
      ],
      oLevel: ["English Language", "Mathematics", "Economics", "Commerce"],
      extraOLevel: ["Government", "Geography", "Civic Education", "Biology", "Agricultural Science"],
    },
  },
];

/** mulberry32 — a small, fast, seedable PRNG. */
function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  return { next, normal, pick };
}

type Rng = ReturnType<typeof createRng>;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function pickStream(rng: Rng): Stream {
  let roll = rng.next();
  for (const { weight, stream } of STREAMS) {
    if (roll < weight) return stream;
    roll -= weight;
  }
  return STREAMS[0].stream;
}

function gradeFor(rng: Rng, ability: number): OLevelGrade {
  return GRADES[clamp(Math.round(2.5 - 1.6 * ability + rng.normal() * 1.2), 0, GRADES.length - 1)];
}

export interface SyntheticCandidate {
  candidate: CandidateProfileInput;
  /** Post-UTME as a percentage of the paper's max, or null for a candidate who hasn't sat one. */
  postUtmePercent: number | null;
}

export function generateCandidates(count = SYNTHETIC_CANDIDATES, seed = DEFAULT_SEED): SyntheticCandidate[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => {
    const ability = rng.normal();
    const stream = pickStream(rng);

    const stateRoll = rng.next();
    const stateOfOrigin =
      stateRoll < 0.5 ? rng.pick(SOUTH_WEST) : stateRoll < 0.7 ? rng.pick(ELDS_SAMPLE) : rng.pick(OTHER_STATES);
    const schoolLocationState = rng.next() < 0.8 ? stateOfOrigin : rng.pick(SOUTH_WEST);

    const oLevelSittings = rng.next() < 0.2 ? 2 : 1;
    const extras = stream.extraOLevel.filter(() => rng.next() < 0.6);
    const oLevelResults = [...stream.oLevel, ...extras].slice(0, 9).map((subject) => ({
      subject,
      // Combining two sittings usually means patching up weaker grades, so it nudges them up a little.
      grade: gradeFor(rng, ability + (oLevelSittings === 2 ? 0.3 : 0)),
    }));

    const postUtmePercent = rng.next() < 0.9 ? clamp(Math.round(55 + 15 * ability + rng.normal() * 10), 5, 100) : null;

    return {
      postUtmePercent,
      candidate: {
        id: `synthetic-${i + 1}`,
        fullName: `Synthetic Candidate ${i + 1}`,
        email: `synthetic-${i + 1}@example.com`,
        stateOfOrigin,
        lga: "—",
        schoolLocationState,
        utmeScore: clamp(Math.round(215 + 45 * ability + rng.normal() * 20), 120, 380),
        postUtmeScore: postUtmePercent,
        utmeSubjects: ["Use of English", ...rng.pick(stream.utme)],
        oLevelResults,
        oLevelSittings,
        targetCourseId: "",
        targetUniversityId: "",
      },
    };
  });
}

export interface TrainingRow {
  candidateId: string;
  courseId: string;
  features: number[];
  /** 1 = admitted in the simulated historical outcome, 0 = not. */
  label: number;
}

/**
 * For each synthetic candidate, up to COURSES_PER_CANDIDATE random courses they're actually
 * eligible for (the recommender only ever ranks eligible courses, so that's all it trains on),
 * labelled admitted with probability 1 / (1 + e^(-margin / MARGIN_SPREAD)).
 */
export function buildTrainingRows(
  catalog: Catalog,
  candidates: SyntheticCandidate[],
  seed = DEFAULT_SEED + 1,
): TrainingRow[] {
  const rng = createRng(seed);
  const rows: TrainingRow[] = [];
  if (catalog.courses.length === 0) return rows;

  for (const { candidate, postUtmePercent } of candidates) {
    const tried = new Set<string>();
    let found = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CANDIDATE && found < COURSES_PER_CANDIDATE; attempt++) {
      const course = rng.pick(catalog.courses);
      if (tried.has(course.id)) continue;
      tried.add(course.id);

      const evaluation = evaluateCourse(candidate, postUtmePercent, course, catalog);
      if (!evaluation) continue;
      found++;

      const admittedProbability = 1 / (1 + Math.exp(-normalizedMargin(evaluation) / MARGIN_SPREAD));
      rows.push({
        candidateId: candidate.id,
        courseId: course.id,
        features: toFeatures(evaluation, candidate.oLevelSittings),
        label: rng.next() < admittedProbability ? 1 : 0,
      });
    }
  }
  return rows;
}

/** Fisher–Yates shuffle with the seeded RNG, for a reproducible train/test split. */
export function shuffled<T>(items: T[], seed = DEFAULT_SEED + 2): T[] {
  const rng = createRng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
