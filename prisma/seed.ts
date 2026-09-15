/**
 * Stage 1 seed script.
 *
 * Seeds all 6 universities with their scoring policy and catchment rule, plus a STARTER SUBSET
 * of 3 real courses each (18 total, not the full 210-course catalog from the dossier) so the
 * schema and the per-state cut-off feature can be exercised end-to-end against real numbers.
 *
 * Every figure here traces to docs/jamb-data-dossier.md in the frontend repo
 * (AdebimpeAbdulhamidEniola/future-admissions-compass) — confidence noted per university.
 * Completing the remaining ~192 courses is Stage 1 follow-up work, not blocking later stages
 * (the dossier explicitly says: seed what's confirmed, extend via the admin endpoints later).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The 23-state ELDS list is itself flagged "Uncertain" in the dossier (traces to a 2023 social
// media post, not JAMB/NUC) — used here only as a placeholder default, not a confirmed fact.
const NATIONAL_ELDS_STATES = [
  "Adamawa", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Ebonyi", "Gombe",
  "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Nasarawa", "Niger",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

interface UniversitySeed {
  code: string;
  name: string;
  locationState: string;
  scoringPolicy: {
    utmeWeighting: number;
    postUtmeWeighting: number;
    oLevelWeighting: number;
    utmeMaxScore: number;
    postUtmeMaxScore: number;
  };
  catchmentRule: {
    catchmentStates: string[];
    eldsStates: string[];
    meritQuotaPercent: number;
    catchmentQuotaPercent: number;
    eldsQuotaPercent: number;
  };
  courses: {
    name: string;
    faculty: string;
    meritCutOff: number;
    catchmentCutOff: number;
    eldsCutOff: number;
    catchmentCutOffByState?: Record<string, number>;
    eldsCutOffByState?: Record<string, number>;
    requirement: {
      requiredUtmeSubjects: string[];
      optionalUtmeSubjects: string[];
      requiredOLevelSubjects: string[];
      minimumCredits: number;
    };
  }[];
}

const SCIENCE_OLEVEL = ["English Language", "Mathematics", "Physics", "Chemistry", "Biology"];
const LAW_OLEVEL = ["English Language", "Literature in English", "Government"];
const COMMERCIAL_OLEVEL = ["English Language", "Mathematics", "Economics"];

const UNIVERSITIES: UniversitySeed[] = [
  {
    // Dossier: cut-offs Confirmed (ui.edu.ng, 2024/25 cycle — one cycle old). Formula Likely.
    // Catchment = Merit everywhere at UI (no discount); only ELDS is discounted, unconfirmed states.
    code: "UI",
    name: "University of Ibadan",
    locationState: "Oyo",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 50, oLevelWeighting: 0, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Oyo", "Ogun", "Osun", "Ondo", "Ekiti", "Kwara"], // Uncertain — UI's own page gives no state names
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Medicine and Surgery",
        faculty: "Clinical Sciences",
        meritCutOff: 78.125,
        catchmentCutOff: 78.125, // Confirmed finding: Catch === Merit at UI
        eldsCutOff: 76.25,
        requirement: { requiredUtmeSubjects: ["Biology", "Chemistry", "Physics"], optionalUtmeSubjects: ["Mathematics"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Law",
        faculty: "Law",
        meritCutOff: 67.25,
        catchmentCutOff: 67.25,
        eldsCutOff: 66.75,
        requirement: { requiredUtmeSubjects: ["Literature in English", "Government"], optionalUtmeSubjects: ["History", "Economics"], requiredOLevelSubjects: LAW_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Computer Science",
        faculty: "Science",
        meritCutOff: 71,
        catchmentCutOff: 71,
        eldsCutOff: 60.875,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics"], optionalUtmeSubjects: ["Chemistry"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
  {
    // Dossier: cut-offs Confirmed (unilag.edu.ng, 2025/26 — current cycle). Formula Likely.
    // Real per-state catchment cut-offs; ELDS not addressed by UNILAG's own source.
    code: "UNILAG",
    name: "University of Lagos",
    locationState: "Lagos",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 30, oLevelWeighting: 20, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"], // Confirmed
      eldsStates: NATIONAL_ELDS_STATES, // Uncertain for UNILAG specifically
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Medicine and Surgery",
        faculty: "Clinical Sciences",
        meritCutOff: 85.025,
        catchmentCutOff: 79.75, // fallback shown = Lagos figure; real per-state map below is authoritative
        eldsCutOff: 79.75,
        catchmentCutOffByState: { Ekiti: 79.975, Lagos: 79.75, Ogun: 83.8, Ondo: 81.325, Osun: 81.775, Oyo: 81.575 },
        requirement: { requiredUtmeSubjects: ["Biology", "Chemistry", "Physics"], optionalUtmeSubjects: ["Mathematics"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Law",
        faculty: "Law",
        meritCutOff: 78.225,
        catchmentCutOff: 75.9,
        eldsCutOff: 75.9,
        catchmentCutOffByState: { Ekiti: 73.625, Lagos: 75.9, Ogun: 76.55, Ondo: 75.75, Osun: 76.35, Oyo: 74.525 },
        requirement: { requiredUtmeSubjects: ["Literature in English", "Government"], optionalUtmeSubjects: ["History", "Economics"], requiredOLevelSubjects: LAW_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Computer Science",
        faculty: "Science",
        meritCutOff: 83.425,
        catchmentCutOff: 79.6,
        eldsCutOff: 79.6,
        catchmentCutOffByState: { Ekiti: 80.125, Lagos: 79.6, Ogun: 82.025, Ondo: 77.5, Osun: 79.2, Oyo: 78.1 },
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics"], optionalUtmeSubjects: ["Chemistry"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
  {
    // Dossier: cut-offs Confirmed but for the 2023/24 cycle (not 2025/26). Formula Likely
    // (community-sourced 50% JAMB + 40% Post-UTME + 10% O'Level).
    code: "OAU",
    name: "Obafemi Awolowo University",
    locationState: "Osun",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 40, oLevelWeighting: 10, utmeMaxScore: 400, postUtmeMaxScore: 40 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"], // Confirmed
      eldsStates: NATIONAL_ELDS_STATES, // real sample found (Kogi, Kano, Kwara, Ebonyi, Cross River, Benue, Nasarawa, Rivers) — not proven complete
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Medicine and Surgery",
        faculty: "Clinical Sciences",
        meritCutOff: 84.325,
        catchmentCutOff: 82.175,
        eldsCutOff: 77.575,
        catchmentCutOffByState: { Osun: 83.2, Ogun: 82.325, Ekiti: 82.175, Ondo: 82.175, Oyo: 80.5, Lagos: 75.75 },
        eldsCutOffByState: { Kwara: 77.575, Kogi: 79.05, Ebonyi: 75.1 },
        requirement: { requiredUtmeSubjects: ["Biology", "Chemistry", "Physics"], optionalUtmeSubjects: ["Mathematics"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Law",
        faculty: "Law",
        meritCutOff: 75.325,
        catchmentCutOff: 73.25,
        eldsCutOff: 73.8,
        catchmentCutOffByState: { Oyo: 73.95, Osun: 74.725, Ogun: 73.25, Ondo: 73.775, Ekiti: 73, Lagos: 69 },
        eldsCutOffByState: { Benue: 73.325, "Cross River": 59.3, Ebonyi: 67.025, Kwara: 73.8, Kogi: 74.25, Nasarawa: 56.425, Rivers: 64.325 },
        requirement: { requiredUtmeSubjects: ["Literature in English", "Government"], optionalUtmeSubjects: ["History", "Economics"], requiredOLevelSubjects: LAW_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Civil Engineering",
        faculty: "Engineering & Technology",
        meritCutOff: 70.85,
        catchmentCutOff: 62.22,
        eldsCutOff: 59.0,
        catchmentCutOffByState: { Ekiti: 58.85, Lagos: 62.82, Ogun: 62.22, Ondo: 54.8, Osun: 69.0, Oyo: 69.07 },
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"], optionalUtmeSubjects: [], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
  {
    // Dossier: Likely throughout — no official FUTA page found, cross-confirmed by two aggregators
    // (2026/27 cycle). General JAMB floor 180, distinct from the departmental screening cut-offs below.
    code: "FUTA",
    name: "Federal University of Technology, Akure",
    locationState: "Ondo",
    scoringPolicy: { utmeWeighting: 75, postUtmeWeighting: 0, oLevelWeighting: 25, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ondo", "Ekiti", "Osun", "Oyo", "Lagos"], // Uncertain, aggregator-only
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Civil Engineering",
        faculty: "Engineering & Technology",
        meritCutOff: 71.87,
        catchmentCutOff: 68,
        eldsCutOff: 65,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"], optionalUtmeSubjects: [], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Electrical and Electronics Engineering",
        faculty: "Engineering & Technology",
        meritCutOff: 74.37,
        catchmentCutOff: 70,
        eldsCutOff: 67,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"], optionalUtmeSubjects: [], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Computer Science",
        faculty: "Science",
        meritCutOff: 69,
        catchmentCutOff: 65,
        eldsCutOff: 62,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics"], optionalUtmeSubjects: ["Chemistry"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
  {
    // Dossier: cut-offs Confirmed (FUNAAB's own live admission portal). Formula Confirmed
    // (helpdesk.funaab.edu.ng) — the ONLY formula in the dossier read directly off an official
    // page: a straight 50/50 UTME/O'Level split, no Post-UTME term at all.
    // Cut-offs below are on FUNAAB's own raw JAMB scale (0-400), not a 0-100 aggregate.
    code: "FUNAAB",
    name: "Federal University of Agriculture, Abeokuta",
    locationState: "Ogun",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 0, oLevelWeighting: 50, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti", "Lagos"], // Confirmed, verbatim from funaab.edu.ng
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Veterinary Medicine",
        faculty: "Clinical Sciences",
        meritCutOff: 200,
        catchmentCutOff: 200,
        eldsCutOff: 160,
        requirement: { requiredUtmeSubjects: ["Biology", "Chemistry", "Physics"], optionalUtmeSubjects: ["Mathematics"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Accounting",
        faculty: "Social & Management Sciences",
        meritCutOff: 200,
        catchmentCutOff: 200,
        eldsCutOff: 160,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Economics"], optionalUtmeSubjects: ["Commerce"], requiredOLevelSubjects: COMMERCIAL_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Computer Science",
        faculty: "Science",
        meritCutOff: 200,
        catchmentCutOff: 200,
        eldsCutOff: 160,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics"], optionalUtmeSubjects: ["Chemistry"], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
  {
    // Dossier: UTME floors Likely, cross-confirmed against FUOYE's own 2026/27 admission-requirements
    // document (current cycle) for most courses. Formula Likely. Law's real existence at FUOYE is an
    // OPEN QUESTION — absent from that otherwise-exhaustive 14-faculty document; seeded here anyway
    // as a placeholder pending verification (see docs/jamb-data-dossier.md).
    code: "FUOYE",
    name: "Federal University Oye-Ekiti",
    locationState: "Ekiti",
    scoringPolicy: { utmeWeighting: 60, postUtmeWeighting: 0, oLevelWeighting: 30, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Ondo", "Osun", "Oyo"], // Likely
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      {
        name: "Computer Science",
        faculty: "Science",
        meritCutOff: 61.95,
        catchmentCutOff: 58,
        eldsCutOff: 55,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"], optionalUtmeSubjects: [], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Civil Engineering",
        faculty: "Engineering & Technology",
        meritCutOff: 65.0,
        catchmentCutOff: 61,
        eldsCutOff: 58,
        requirement: { requiredUtmeSubjects: ["Mathematics", "Chemistry", "Physics"], optionalUtmeSubjects: [], requiredOLevelSubjects: SCIENCE_OLEVEL, minimumCredits: 5 },
      },
      {
        name: "Law", // OPEN QUESTION — see comment above
        faculty: "Law",
        meritCutOff: 60,
        catchmentCutOff: 56,
        eldsCutOff: 53,
        requirement: { requiredUtmeSubjects: ["Literature in English", "Government"], optionalUtmeSubjects: ["History"], requiredOLevelSubjects: LAW_OLEVEL, minimumCredits: 5 },
      },
    ],
  },
];

async function main() {
  for (const uni of UNIVERSITIES) {
    const university = await prisma.university.upsert({
      where: { code: uni.code },
      update: { name: uni.name, locationState: uni.locationState },
      create: { code: uni.code, name: uni.name, locationState: uni.locationState },
    });

    await prisma.scoringPolicy.upsert({
      where: { universityId: university.id },
      update: uni.scoringPolicy,
      create: { universityId: university.id, ...uni.scoringPolicy },
    });

    await prisma.catchmentRule.upsert({
      where: { universityId: university.id },
      update: uni.catchmentRule,
      create: { universityId: university.id, ...uni.catchmentRule },
    });

    for (const course of uni.courses) {
      const courseData = {
        faculty: course.faculty,
        meritCutOff: course.meritCutOff,
        catchmentCutOff: course.catchmentCutOff,
        eldsCutOff: course.eldsCutOff,
        catchmentCutOffByState: course.catchmentCutOffByState ?? undefined,
        eldsCutOffByState: course.eldsCutOffByState ?? undefined,
      };

      const courseRow = await prisma.course.upsert({
        where: { universityId_name: { universityId: university.id, name: course.name } },
        update: courseData,
        create: { universityId: university.id, name: course.name, ...courseData },
      });

      await prisma.admissionRequirement.upsert({
        where: { courseId: courseRow.id },
        update: course.requirement,
        create: { courseId: courseRow.id, ...course.requirement },
      });
    }

    console.log(`Seeded ${uni.name} (${uni.courses.length} courses)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
