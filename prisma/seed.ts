/**
 * Stage 1 seed script — full catalog.
 *
 * Every course, faculty, and cut-off figure below is transcribed directly from
 * docs/jamb-data-dossier.md in the frontend repo (AdebimpeAbdulhamidEniola/future-admissions-compass).
 * Nothing here is invented: where the dossier has no confirmed figure for a course (marked "—"),
 * the corresponding field is `null`, not a guess. Re-read the dossier before changing any number
 * here rather than trusting this file's history.
 *
 * SCALE NOTE — read before touching cut-off numbers:
 * computeAggregate() always produces a 0–100 aggregate (it converts every component to a percent
 * of its max before applying weightings), so Course.meritCutOff/catchmentCutOff/eldsCutOff must be
 * on that same 0–100 scale to compare sensibly.
 *   - UI, UNILAG, OAU: dossier gives a native 0–100 aggregate. Used as-is.
 *   - FUTA, FUOYE: dossier gives BOTH a 0–100 aggregate and a separate raw-JAMB/"estimated JAMB
 *     score" figure. Only the 0–100 aggregate column is used here; the raw-JAMB figures are not
 *     stored (no schema field for them) and must not be substituted in as if comparable.
 *   - FUNAAB: the dossier's ONLY published cut-off is the raw 0–400 JAMB floor — no 0–100 aggregate
 *     is published anywhere, even though FUNAAB's own Confirmed formula computes one internally.
 *     Seeded here as published (raw 0–400), which means computeAggregate() (maxing at 100) can
 *     never clear a FUNAAB cut-off of 160–200. This is a known, UNRESOLVED scale mismatch inherited
 *     from the source data, not a bug introduced here — see the dossier's FUNAAB section and its
 *     "why cut-off scales aren't comparable" callout. Needs a real FUNAAB 0–100 aggregate figure
 *     (Stage 5 admin CRUD, or further research) before FUNAAB assessments can work correctly.
 *
 * EXCLUDED COURSES: FUTA and FUNAAB's dossier tables include "Law" / "Arts" placeholder rows
 * stating "No Law faculty exists" / "No Arts faculty exists" — those are informational asides in
 * the dossier's markdown, not real courses, and are not seeded. FUOYE's Law row DOES have a cut-off
 * value (150) but the dossier flags it as an open question whether the faculty exists at all
 * (absent from an otherwise-exhaustive 14-faculty admission-requirements document) — seeded anyway
 * since a real number exists, but flagged loudly below.
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

// --- AdmissionRequirement templates, keyed by faculty. --------------------------------------
// The dossier documents a general per-stream O'Level/UTME rule (see its UNILAG and FUTA
// sections) rather than an exact subject list for every one of the 210 courses — applying it
// uniformly here is the honest choice, not a shortcut, since inventing a more specific
// combination per course wouldn't trace to anything in the source. The one exception is FUOYE,
// which has its own detailed per-course admission-requirements document (see the dossier's
// FUOYE section and this repo's README) — worth revisiting this file once that's transcribed.
interface RequirementTemplate {
  requiredUtmeSubjects: string[];
  optionalUtmeSubjects: string[];
  requiredOLevelSubjects: string[];
  minimumCredits: number;
}

const REQUIREMENT_TEMPLATES: Record<string, RequirementTemplate> = {
  "Clinical Sciences": {
    requiredUtmeSubjects: ["Biology", "Chemistry", "Physics"],
    optionalUtmeSubjects: ["Mathematics"],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Biology", "Chemistry", "Physics"],
    minimumCredits: 5,
  },
  Law: {
    requiredUtmeSubjects: ["Literature in English", "Government"],
    optionalUtmeSubjects: ["History", "Economics"],
    requiredOLevelSubjects: ["English Language", "Literature in English", "Government"],
    minimumCredits: 5,
  },
  Arts: {
    requiredUtmeSubjects: ["Literature in English"],
    optionalUtmeSubjects: ["History", "Government", "Christian Religious Studies", "Yoruba"],
    requiredOLevelSubjects: ["English Language", "Literature in English"],
    minimumCredits: 5,
  },
  "Social & Management Sciences": {
    requiredUtmeSubjects: ["Mathematics", "Economics"],
    optionalUtmeSubjects: ["Government", "Geography", "Commerce"],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Economics"],
    minimumCredits: 5,
  },
  "Engineering & Technology": {
    requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"],
    optionalUtmeSubjects: ["Further Mathematics"],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Physics", "Chemistry"],
    minimumCredits: 5,
  },
  Science: {
    requiredUtmeSubjects: ["Mathematics", "Physics"],
    optionalUtmeSubjects: ["Chemistry", "Biology"],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Physics", "Chemistry"],
    minimumCredits: 5,
  },
  Agriculture: {
    requiredUtmeSubjects: ["Chemistry", "Biology"],
    optionalUtmeSubjects: ["Mathematics", "Physics", "Agricultural Science"],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Biology", "Chemistry"],
    minimumCredits: 5,
  },
};

function requirementFor(faculty: string): RequirementTemplate {
  const template = REQUIREMENT_TEMPLATES[faculty];
  if (!template) throw new Error(`No AdmissionRequirement template for faculty "${faculty}"`);
  return template;
}

// --- Course seed shape -----------------------------------------------------------------------
interface CourseSeed {
  name: string;
  faculty: string;
  merit: number | null;
  catchment: number | null;
  elds: number | null;
  catchmentByState?: Record<string, number>;
  eldsByState?: Record<string, number>;
}

function c(
  name: string,
  faculty: string,
  merit: number | null,
  catchment: number | null,
  elds: number | null,
  extra?: { catchmentByState?: Record<string, number>; eldsByState?: Record<string, number> },
): CourseSeed {
  return { name, faculty, merit, catchment, elds, ...extra };
}

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
  courses: CourseSeed[];
}

const UNIVERSITIES: UniversitySeed[] = [
  // ============================================================================================
  // University of Ibadan — Confirmed (ui.edu.ng, 2024/25 cycle). Formula Likely.
  // Real finding: Catchment cut-off == Merit cut-off on every course (no discount at all) — only
  // ELDS is discounted, and only on some courses. Catchment/ELDS state names remain Uncertain
  // (the official page gives numbers only), so no by-state maps here — just flat merit/elds.
  // ============================================================================================
  {
    code: "UI",
    name: "University of Ibadan",
    locationState: "Oyo",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 50, oLevelWeighting: 0, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Oyo", "Ogun", "Osun", "Ondo", "Ekiti", "Kwara"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Medicine and Surgery", "Clinical Sciences", 78.125, 78.125, 76.25),
      c("Dentistry", "Clinical Sciences", 69.125, 69.125, 63.625),
      c("Nursing Science", "Clinical Sciences", 71.875, 71.875, 63.375),
      c("Physiotherapy", "Clinical Sciences", 64.75, 64.75, 61.125),
      c("Pharmacy", "Clinical Sciences", 68, 68, 65.625),
      c("Law", "Law", 67.25, 67.25, 66.75),
      c("Civil Engineering", "Engineering & Technology", 61.625, 61.625, 53.625),
      c("Mechanical Engineering", "Engineering & Technology", 68, 68, 55.125),
      c("Electrical and Electronic Engineering", "Engineering & Technology", 67, 67, 50.25),
      c("Agricultural and Environmental Engineering", "Engineering & Technology", 50, 50, 50),
      c("Petroleum Engineering", "Engineering & Technology", 61.25, 61.25, 53.625),
      c("English", "Arts", 57.125, 57.125, 55.25),
      c("History", "Arts", 50, 50, 50),
      c("Linguistics and African Languages", "Arts", 58.125, 58.125, 51.625),
      c("Theatre Arts", "Arts", 55.75, 55.75, 53.125),
      c("Religious Studies", "Arts", 50, 50, 50),
      c("Music", "Arts", 50, 50, 50),
      c("Economics", "Social & Management Sciences", 58.5, 58.5, 52.375),
      c("Political Science", "Social & Management Sciences", 55.875, 55.875, 55.375),
      c("Psychology", "Social & Management Sciences", 53.75, 53.75, 53.75),
      c("Sociology", "Social & Management Sciences", 50.5, 50.5, 50.5),
      c("Geography", "Social & Management Sciences", 50, 50, 50),
      c("Chemistry", "Science", 50, 50, 50),
      c("Physics", "Science", 51, 51, 51),
      c("Microbiology", "Science", 52.75, 52.75, 52.125),
      c("Computer Science", "Science", 71, 71, 60.875),
      c("Mathematics", "Science", 52, 52, 52),
      c("Statistics", "Science", 50, 50, 50),
      c("Botany", "Science", 50, 50, 50),
      c("Agricultural Economics", "Agriculture", 50.375, 50.375, 50.375),
      c("Crop and Horticultural Sciences", "Agriculture", 50, 50, 50),
      c("Animal Science", "Agriculture", 50, 50, 50),
      c("Crop Protection and Environmental Biology", "Agriculture", 50, 50, 50),
      c("Aquaculture and Fisheries Management", "Agriculture", 50, 50, 50),
      c("Forest Resources Management", "Agriculture", 50, 50, 50),
    ],
  },

  // ============================================================================================
  // University of Lagos — Confirmed (unilag.edu.ng, 3 Oct 2025, current 2025/26 cycle).
  // Catchment states Confirmed (Ekiti/Lagos/Ogun/Ondo/Osun/Oyo); per-state figures only exist in
  // the dossier for 5 sample courses (Medicine, Law, Computer Science, Accounting, Civil
  // Engineering) — the other 30 courses get only their single Merit figure, catchment/ELDS null.
  // ELDS unconfirmed for UNILAG entirely (the official page never mentions it) — null everywhere.
  // ============================================================================================
  {
    code: "UNILAG",
    name: "University of Lagos",
    locationState: "Lagos",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 30, oLevelWeighting: 20, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Medicine and Surgery", "Clinical Sciences", 85.025, 79.75, null, {
        catchmentByState: { Ekiti: 79.975, Lagos: 79.75, Ogun: 83.8, Ondo: 81.325, Osun: 81.775, Oyo: 81.575 },
      }),
      c("Dentistry and Dental Surgery", "Clinical Sciences", 76.65, null, null),
      c("Nursing Science", "Clinical Sciences", 79.8, null, null),
      c("Physiotherapy", "Clinical Sciences", 74.725, null, null),
      c("Medical Laboratory Science", "Clinical Sciences", 74.375, null, null),
      c("Pharmacy", "Clinical Sciences", 76.4, null, null),
      c("Law", "Law", 78.225, 75.9, null, {
        catchmentByState: { Ekiti: 73.625, Lagos: 75.9, Ogun: 76.55, Ondo: 75.75, Osun: 76.35, Oyo: 74.525 },
      }),
      c("Civil Engineering", "Engineering & Technology", 75.625, 74.5, null, {
        catchmentByState: { Ekiti: 65.525, Lagos: 74.5, Ogun: 72.075, Ondo: 65.575, Osun: 72.375, Oyo: 71.05 },
      }),
      c("Mechanical Engineering", "Engineering & Technology", 78.525, null, null),
      c("Electrical and Electronics Engineering", "Engineering & Technology", 79.5, null, null),
      c("Chemical Engineering", "Engineering & Technology", 72.8, null, null),
      c("Surveying and Geoinformatics Engineering", "Engineering & Technology", 58.125, null, null),
      c("Metallurgical and Materials Engineering", "Engineering & Technology", 59.8, null, null),
      c("English", "Arts", 68.175, null, null),
      c("History and Strategic Studies", "Arts", 70.725, null, null),
      c("Philosophy", "Arts", 66.075, null, null),
      c("Linguistics, African and Asian Studies", "Arts", 72.55, null, null),
      c("Religious Studies", "Arts", 54.625, null, null),
      c("European Languages and Integrated Studies", "Arts", 60.225, null, null),
      c("Accounting", "Social & Management Sciences", 75.7, 71.4, null, {
        catchmentByState: { Ekiti: 69.475, Lagos: 71.4, Ogun: 73.825, Ondo: 68.8, Osun: 72.325, Oyo: 71 },
      }),
      c("Business Administration", "Social & Management Sciences", 69.3, null, null),
      c("Actuarial Science and Insurance", "Social & Management Sciences", 64.925, null, null),
      c("Banking and Finance", "Social & Management Sciences", 70.35, null, null),
      c("Industrial Relations and Personnel Management", "Social & Management Sciences", 60.775, null, null),
      c("Economics", "Social & Management Sciences", 73.475, null, null),
      c("Psychology", "Social & Management Sciences", 69.7, null, null),
      c("Political Science", "Social & Management Sciences", 68.15, null, null),
      c("Computer Science", "Science", 83.425, 79.6, null, {
        catchmentByState: { Ekiti: 80.125, Lagos: 79.6, Ogun: 82.025, Ondo: 77.5, Osun: 79.2, Oyo: 78.1 },
      }),
      c("Physics", "Science", 60.25, null, null),
      c("Chemistry", "Science", 59.5, null, null),
      c("Mathematics", "Science", 63.675, null, null),
      c("Biochemistry", "Science", 69.4, null, null),
      c("Botany", "Science", 51.45, null, null),
      c("Zoology", "Science", 57.25, null, null),
      c("Marine Sciences / Marine Biology", "Science", 55.45, null, null),
    ],
  },

  // ============================================================================================
  // Obafemi Awolowo University — Confirmed, but 2023/24 cycle (not 2025/26). All 35 courses have
  // rich catchment/ELDS-by-state detail from OAU's own per-faculty documents. Catchment states
  // Confirmed (Ekiti/Lagos/Ogun/Ondo/Osun/Oyo) across all 8 documents. ELDS is per-state for
  // College of Health Sciences/Faculty of Pharmacy/Faculty of Law, and a single flat figure for
  // Technology/Arts/Social Sciences/Science/Agriculture/Administration.
  // ============================================================================================
  {
    code: "OAU",
    name: "Obafemi Awolowo University",
    locationState: "Osun",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 40, oLevelWeighting: 10, utmeMaxScore: 400, postUtmeMaxScore: 40 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      // College of Health Sciences
      c("Medicine and Surgery", "Clinical Sciences", 84.325, 82.175, null, {
        catchmentByState: { Osun: 83.2, Ogun: 82.325, Ekiti: 82.175, Ondo: 82.175, Oyo: 80.5, Lagos: 75.75 },
        eldsByState: { Kwara: 77.575, Kogi: 79.05, Ebonyi: 75.1 },
      }),
      c("Dentistry / Dental Surgery", "Clinical Sciences", 80.125, 76.125, null, {
        catchmentByState: { Osun: 76.125, Ogun: 78.85, Ekiti: 72.725, Ondo: 76.45, Oyo: 78.45, Lagos: 75.25 },
        eldsByState: { Kwara: 71.35 },
      }),
      c("Nursing Science", "Clinical Sciences", 79.225, 77.1, null, {
        catchmentByState: { Osun: 77.525, Ogun: 77.1, Ekiti: 76, Ondo: 76.55, Oyo: 76.725, Lagos: 74.25 },
        eldsByState: { Kogi: 70.2, "Cross River": 70.9, Kwara: 70.725, Ebonyi: 73.225, Benue: 70.775 },
      }),
      c("Medical Rehabilitation (Physiotherapy/OT)", "Clinical Sciences", 73.5, 70.375, null, {
        catchmentByState: { Osun: 73.025, Ogun: 70.375, Ekiti: 71.05, Ondo: 69.65, Oyo: 72.075, Lagos: 67.9 },
        eldsByState: { Kogi: 70.775, Kano: 72.525, Kwara: 67.775, Ebonyi: 71.1 },
      }),
      // Faculty of Pharmacy
      c("Pharmacy", "Clinical Sciences", 76.15, 73.9, null, {
        catchmentByState: { Ekiti: 72.075, Lagos: 70.45, Ogun: 73.9, Ondo: 72.425, Osun: 74.9, Oyo: 73.9 },
        eldsByState: { Benue: 69.175, "Cross River": 69.325, Ebonyi: 68.375, Kaduna: 57.125, Kogi: 69.625, Kwara: 69.15 },
      }),
      // Faculty of Law
      c("Law", "Law", 75.325, 73.25, null, {
        catchmentByState: { Oyo: 73.95, Osun: 74.725, Ogun: 73.25, Ondo: 73.775, Ekiti: 73, Lagos: 69 },
        eldsByState: { Benue: 73.325, "Cross River": 59.3, Ebonyi: 67.025, Kwara: 73.8, Kogi: 74.25, Nasarawa: 56.425, Rivers: 64.325 },
      }),
      // Faculty of Technology
      c("Civil Engineering", "Engineering & Technology", 70.85, 62.22, 59.0, {
        catchmentByState: { Ekiti: 58.85, Lagos: 62.82, Ogun: 62.22, Ondo: 54.8, Osun: 69.0, Oyo: 69.07 },
      }),
      c("Mechanical Engineering", "Engineering & Technology", 72.07, 66.37, 56.0, {
        catchmentByState: { Ekiti: 62.6, Lagos: 54.87, Ogun: 66.37, Ondo: 53.92, Osun: 70.65, Oyo: 66.62 },
      }),
      c("Electronic and Electrical Engineering", "Engineering & Technology", 70.87, 66.72, 59.57, {
        catchmentByState: { Ekiti: 57.15, Lagos: 61.37, Ogun: 66.72, Ondo: 52.3, Osun: 68.15, Oyo: 68.07 },
      }),
      c("Chemical Engineering", "Engineering & Technology", 68.28, 61.15, 59.17, {
        catchmentByState: { Ekiti: 63.17, Lagos: 63.17, Ogun: 61.15, Ondo: 62.02, Osun: 65.72, Oyo: 57.95 },
      }),
      c("Agricultural and Environmental Engineering", "Engineering & Technology", 53.12, 50.0, 50.0, {
        catchmentByState: { Ekiti: 50.0, Lagos: 50.0, Ogun: 50.0, Ondo: 50.0, Osun: 50.0, Oyo: 50.0 },
      }),
      // Faculty of Arts (catchment column order Likely Ekiti/Lagos/Ogun/Ondo/Osun/Oyo, not independently confirmed)
      c("English Language", "Arts", 64.825, 56.325, 50, {
        catchmentByState: { Ekiti: 63.225, Lagos: 60.675, Ogun: 56.325, Ondo: 56.45, Osun: 58.025, Oyo: 59.325 },
      }),
      c("History", "Arts", 62.625, 60.125, 50, {
        catchmentByState: { Ekiti: 57.475, Lagos: 54.2, Ogun: 60.125, Ondo: 50, Osun: 61.325, Oyo: 50 },
      }),
      c("Linguistics and African Languages", "Arts", 65.725, 56.9, 50, {
        catchmentByState: { Ekiti: 65, Lagos: 63.7, Ogun: 56.9, Ondo: 57, Osun: 58.55, Oyo: 59.4 },
      }),
      c("Philosophy", "Arts", 51.4, 50, 50, {
        catchmentByState: { Ekiti: 50, Lagos: 50, Ogun: 50, Ondo: 50, Osun: 50, Oyo: 50 },
      }),
      c("Religious Studies", "Arts", 62.05, 50, 50, {
        catchmentByState: { Ekiti: 50, Lagos: 50, Ogun: 50, Ondo: 50, Osun: 50, Oyo: 50 },
      }),
      c("Dramatic Arts", "Arts", 65.8, 63.4, 50, {
        catchmentByState: { Ekiti: 64.375, Lagos: 61.925, Ogun: 63.4, Ondo: 51.525, Osun: 62.85, Oyo: 53.275 },
      }),
      c("Music", "Arts", 51.125, 50, 50, {
        catchmentByState: { Ekiti: 50, Lagos: 50, Ogun: 50, Ondo: 50, Osun: 50, Oyo: 50 },
      }),
      // Faculty of Social Sciences
      c("Economics", "Social & Management Sciences", 65.63, 61.43, 51.93, {
        catchmentByState: { Osun: 63.0, Oyo: 59.8, Ekiti: 55.8, Ondo: 53.33, Lagos: 57.05, Ogun: 61.43 },
      }),
      c("Political Science", "Social & Management Sciences", 65.35, 61.15, 54.5, {
        catchmentByState: { Osun: 62.38, Oyo: 62.93, Ekiti: 58.35, Ondo: 58.15, Lagos: 64.15, Ogun: 61.15 },
      }),
      c("Sociology and Anthropology", "Social & Management Sciences", 52.53, 50, 50, {
        catchmentByState: { Osun: 50, Oyo: 50, Ekiti: 50, Ondo: 50, Lagos: 50, Ogun: 50 },
      }),
      // Faculty of Administration (real home of Accounting/Business Administration, per dossier)
      c("Accounting", "Social & Management Sciences", 71.67, 69.37, 51.77, {
        catchmentByState: { Ekiti: 68.57, Oyo: 70.57, Ogun: 69.37, Osun: 70.57, Ondo: 61.17, Lagos: 63.37 },
      }),
      c("Business Administration", "Social & Management Sciences", 65.5, 61.57, 51.57, {
        catchmentByState: { Ekiti: 59.27, Oyo: 62.0, Ogun: 61.57, Osun: 62.75, Ondo: 56.52, Lagos: 52.12 },
      }),
      // Faculty of Science (all courses sit at the 50 floor except Microbiology)
      c("Chemistry", "Science", 50.0, 50.0, 50.0),
      c("Physics", "Science", 50.0, 50.0, 50.0),
      c("Microbiology", "Science", 62.07, 52.4, 53.3, {
        catchmentByState: { Osun: 54.17, Oyo: 52.52, Ondo: 52.37, Ogun: 52.4, Lagos: 50.0, Ekiti: 52.82 },
      }),
      c("Zoology", "Science", 50.0, 50.0, 50.0),
      c("Mathematics", "Science", 50.0, 50.0, 50.0),
      c("Botany", "Science", 50.0, 50.0, 50.0),
      c("Geology", "Science", 50.0, 50.0, 50.0),
      // Faculty of Agriculture (every course sits at the 50 catchment floor this cycle)
      c("Agricultural Economics", "Agriculture", 51.93, 50.0, 50.0),
      c("Animal Sciences", "Agriculture", 50.4, 50.0, 50.0),
      c("Crop Production and Protection", "Agriculture", 56.08, 50.0, 50.0),
      c("Soil Science and Land Resources Management", "Agriculture", 56.38, 50.0, 50.0),
      c("Agricultural Extension and Rural Development", "Agriculture", 52.33, 50.0, 50.0),
    ],
  },

  // ============================================================================================
  // FUTA — Likely (Campusdesk, 2026/27 cycle; not futa.edu.ng itself). Only the 0–100 Aggregate
  // column is used (see SCALE NOTE) — the raw Est. JAMB column is not stored. "Law" and "Arts"
  // are excluded entirely: the dossier explicitly states no such faculty exists at FUTA.
  // Catchment/ELDS: states are Uncertain (Ondo/Ekiti/Osun/Oyo/Lagos guess) and NO cut-off numbers
  // are published anywhere for either — null for every course.
  // ============================================================================================
  {
    code: "FUTA",
    name: "Federal University of Technology, Akure",
    locationState: "Ondo",
    scoringPolicy: { utmeWeighting: 75, postUtmeWeighting: 0, oLevelWeighting: 25, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ondo", "Ekiti", "Osun", "Oyo", "Lagos"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Medicine and Surgery (MBBS)", "Clinical Sciences", null, null, null),
      c("Nursing Science", "Clinical Sciences", 75.0, null, null),
      c("Human Anatomy", "Clinical Sciences", 59.5, null, null),
      c("Physiology", "Clinical Sciences", 57.25, null, null),
      c("Civil and Environmental Engineering", "Engineering & Technology", 71.87, null, null),
      c("Mechanical Engineering", "Engineering & Technology", 73.75, null, null),
      c("Electrical/Electronics Engineering", "Engineering & Technology", 74.37, null, null),
      c("Chemical Engineering", "Engineering & Technology", null, null, null),
      c("Agricultural and Environmental Engineering", "Engineering & Technology", 55.12, null, null),
      c("Computer Engineering", "Engineering & Technology", 69.62, null, null),
      c("Industrial and Production Engineering", "Engineering & Technology", 47.5, null, null),
      c("Metallurgical and Materials Engineering", "Engineering & Technology", 54.87, null, null),
      c("Mining Engineering", "Engineering & Technology", 54.75, null, null),
      c("Mechatronics Engineering", "Engineering & Technology", null, null, null),
      c("Business Information Technology", "Social & Management Sciences", null, null, null),
      c("Entrepreneurship Management Technology", "Social & Management Sciences", null, null, null),
      c("Logistics and Transport Technology", "Social & Management Sciences", null, null, null),
      c("Project Management Technology", "Social & Management Sciences", null, null, null),
      c("Procurement Management Technology", "Social & Management Sciences", null, null, null),
      c("Physics", "Science", 47.5, null, null),
      c("Chemistry", "Science", 47.5, null, null),
      c("Mathematics", "Science", 59, null, null),
      c("Statistics", "Science", 47.5, null, null),
      c("Biochemistry", "Science", 63.37, null, null),
      c("Biology", "Science", 47.5, null, null),
      c("Microbiology", "Science", 63, null, null),
      c("Biotechnology", "Science", 47.5, null, null),
      c("Computer Science", "Science", 69, null, null),
      c("Cybersecurity", "Science", 63.75, null, null),
      c("Animal Production and Health", "Agriculture", 55.37, null, null),
      c("Crop, Soil and Pest Management", "Agriculture", 47.5, null, null),
      c("Food Science and Technology", "Agriculture", 58.12, null, null),
      c("Forestry and Wood Technology", "Agriculture", 47.5, null, null),
      c("Agricultural Extension and Communication Technology", "Agriculture", 47.5, null, null),
      c("Agricultural and Resource Economics", "Agriculture", 47.5, null, null),
    ],
  },

  // ============================================================================================
  // FUNAAB — cut-offs Confirmed (funaab.edu.ng, 2026/27 portal), formula Confirmed
  // (helpdesk.funaab.edu.ng). SCALE MISMATCH: these are raw 0–400 JAMB floors, not the 0–100
  // aggregate the Confirmed formula computes — see the SCALE NOTE at the top of this file.
  // "Law" and "Arts" excluded: the dossier states neither faculty exists at FUNAAB.
  // Catchment states Confirmed (Ogun/Oyo/Osun/Ondo/Ekiti/Lagos); no catchment/ELDS cut-off
  // numbers are published anywhere — null for every course.
  // ============================================================================================
  {
    code: "FUNAAB",
    name: "Federal University of Agriculture, Abeokuta",
    locationState: "Ogun",
    scoringPolicy: { utmeWeighting: 50, postUtmeWeighting: 0, oLevelWeighting: 50, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti", "Lagos"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Veterinary Medicine (DVM)", "Clinical Sciences", 200, null, null),
      c("Agricultural Engineering", "Engineering & Technology", 200, null, null),
      c("Civil Engineering", "Engineering & Technology", 200, null, null),
      c("Electrical and Electronics Engineering", "Engineering & Technology", 200, null, null),
      c("Mechanical Engineering", "Engineering & Technology", 200, null, null),
      c("Mechatronic Engineering", "Engineering & Technology", 200, null, null),
      c("Agricultural Economics and Farm Management", "Social & Management Sciences", 160, null, null),
      c("Agricultural Extension and Rural Development", "Social & Management Sciences", 160, null, null),
      c("Agricultural Administration", "Social & Management Sciences", 160, null, null),
      c("Cooperative Studies", "Social & Management Sciences", 160, null, null),
      c("Development Studies", "Social & Management Sciences", 160, null, null),
      c("Accounting", "Social & Management Sciences", 200, null, null),
      c("Banking and Finance", "Social & Management Sciences", 200, null, null),
      c("Business Administration", "Social & Management Sciences", 200, null, null),
      c("Economics", "Social & Management Sciences", 200, null, null),
      c("Computer Science", "Science", 200, null, null),
      c("Physics", "Science", 200, null, null),
      c("Chemistry", "Science", 180, null, null),
      c("Biochemistry", "Science", 200, null, null),
      c("Microbiology", "Science", 200, null, null),
      c("Mathematics", "Science", 200, null, null),
      c("Statistics", "Science", 200, null, null),
      c("Cyber Security", "Science", 200, null, null),
      c("Data Science", "Science", 200, null, null),
      c("Information Technology", "Science", 200, null, null),
      c("Software Engineering", "Science", 200, null, null),
      c("Animal Production and Health", "Agriculture", 160, null, null),
      c("Crop Protection", "Agriculture", 160, null, null),
      c("Soil Science and Land Management", "Agriculture", 160, null, null),
      c("Aquaculture and Fisheries Management", "Agriculture", 160, null, null),
      c("Forest Resource Management", "Agriculture", 160, null, null),
      c("Animal Breeding and Genetics", "Agriculture", 160, null, null),
      c("Plant Breeding and Seed Technology", "Agriculture", 160, null, null),
      c("Horticulture", "Agriculture", 160, null, null),
      c("Wildlife and Eco-tourism Management", "Agriculture", 160, null, null),
    ],
  },

  // ============================================================================================
  // FUOYE — UTME floors Likely, cross-confirmed against FUOYE's own 2026/27 admission-requirements
  // document for most courses; only the 0–100 Aggregate column is used here (see SCALE NOTE).
  // "Law" is seeded (a real number, 150-floor era aggregate is unknown → null) but flagged: the
  // dossier raises a genuine open question over whether FUOYE's Law faculty exists at all, since
  // it's absent from an otherwise-exhaustive 14-faculty admission-requirements document.
  // Catchment states Likely (Ekiti/Ondo/Osun/Oyo); no catchment/ELDS cut-off numbers published —
  // null for every course.
  // ============================================================================================
  {
    code: "FUOYE",
    name: "Federal University Oye-Ekiti",
    locationState: "Ekiti",
    scoringPolicy: { utmeWeighting: 60, postUtmeWeighting: 0, oLevelWeighting: 30, utmeMaxScore: 400, postUtmeMaxScore: 100 },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Ondo", "Osun", "Oyo"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Anatomy", "Clinical Sciences", 63.3, null, null),
      c("Physiology", "Clinical Sciences", 61.5, null, null),
      c("Nursing Science", "Clinical Sciences", 74.6, null, null),
      c("Medical Laboratory Science", "Clinical Sciences", 72.3, null, null),
      c("Radiography and Radiation Science", "Clinical Sciences", 71.3, null, null),
      // OPEN QUESTION: FUOYE Law's existence is unconfirmed — see dossier. Aggregate cut-off unknown.
      c("Law", "Law", null, null, null),
      c("Civil Engineering", "Engineering & Technology", 65.0, null, null),
      c("Mechanical Engineering", "Engineering & Technology", 65.0, null, null),
      c("Electrical and Electronic Engineering", "Engineering & Technology", 63.3, null, null),
      c("Computer Engineering", "Engineering & Technology", 64.3, null, null),
      c("Mechatronics Engineering", "Engineering & Technology", 65.0, null, null),
      c("English and Literary Studies", "Arts", 66.3, null, null),
      c("History and International Studies", "Arts", 67.8, null, null),
      c("Linguistics and Languages", "Arts", 65.3, null, null),
      c("Philosophy", "Arts", 57.2, null, null),
      c("Religious Studies", "Arts", 55.0, null, null),
      c("Economics", "Social & Management Sciences", 63.75, null, null),
      c("Political Science", "Social & Management Sciences", 62.5, null, null),
      c("Accounting", "Social & Management Sciences", 65.15, null, null),
      c("Business Administration", "Social & Management Sciences", 65.45, null, null),
      c("Mass Communication", "Social & Management Sciences", 66.3, null, null),
      c("Computer Science", "Science", 61.95, null, null),
      c("Biochemistry", "Science", 64.4, null, null),
      c("Microbiology", "Science", 65.75, null, null),
      c("Physics", "Science", 56.5, null, null),
      c("Chemistry", "Science", 62.5, null, null),
      c("Mathematics", "Science", 55.5, null, null),
      c("Statistics", "Science", 54.5, null, null),
      c("Animal Production and Health", "Agriculture", 57.7, null, null),
      c("Crop Science and Horticulture", "Agriculture", 57.65, null, null),
      c("Agricultural Economics and Extension", "Agriculture", 61.15, null, null),
      c("Soil Science and Land Resources Management", "Agriculture", 56.65, null, null),
      c("Fisheries and Aquaculture", "Agriculture", 57.15, null, null),
      c("Food Science and Technology", "Agriculture", 60.9, null, null),
      c("Water Resources Management and Agrometeorology", "Agriculture", 57.3, null, null),
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
        meritCutOff: course.merit,
        catchmentCutOff: course.catchment,
        eldsCutOff: course.elds,
        catchmentCutOffByState: course.catchmentByState ?? undefined,
        eldsCutOffByState: course.eldsByState ?? undefined,
      };

      const courseRow = await prisma.course.upsert({
        where: { universityId_name: { universityId: university.id, name: course.name } },
        update: courseData,
        create: { universityId: university.id, name: course.name, ...courseData },
      });

      const requirement = requirementFor(course.faculty);
      await prisma.admissionRequirement.upsert({
        where: { courseId: courseRow.id },
        update: requirement,
        create: { courseId: courseRow.id, ...requirement },
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
