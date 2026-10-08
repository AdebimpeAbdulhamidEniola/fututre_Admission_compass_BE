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
 *     The 0–100 cut-off fields stay null and the raw floor goes in Course.utmeCutOff instead: the
 *     engine then judges FUNAAB candidates on their UTME score against that floor, while still
 *     showing their 0–100 aggregate. No conversion factor is invented.
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
  "Adamawa",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Ebonyi",
  "Gombe",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Nasarawa",
  "Niger",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];

// --- AdmissionRequirement templates, keyed by faculty. --------------------------------------
// The dossier documents a general per-stream O'Level/UTME rule (see its UNILAG and FUTA
// sections) rather than an exact subject list for every one of the 210 courses — applying it
// uniformly here is the honest choice, not a shortcut, since inventing a more specific
// combination per course wouldn't trace to anything in the source. The one exception is FUOYE,
// which has its own detailed per-course admission-requirements document (see the dossier's
// FUOYE section and this repo's README) — worth revisiting this file once that's transcribed.
interface OLevelSubstitution {
  subject: string;
  alternatives: string[];
  countsTowardPoints: boolean;
}

interface RequirementTemplate {
  requiredUtmeSubjects: string[];
  optionalUtmeSubjects: string[];
  /** "One of" UTME groups: at least one subject from each (see AdmissionRequirement.utmeSubjectGroups). */
  utmeSubjectGroups?: string[][];
  requiredOLevelSubjects: string[];
  minimumCredits: number;
  oLevelSubstitutions?: OLevelSubstitution[];
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
    optionalUtmeSubjects: [
      "History",
      "Economics",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
      "Geography",
    ],
    requiredOLevelSubjects: ["English Language", "Literature in English", "Government"],
    minimumCredits: 5,
  },
  Arts: {
    requiredUtmeSubjects: ["Literature in English"],
    optionalUtmeSubjects: [
      "History",
      "Government",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
      "Economics",
      "Geography",
      "French",
    ],
    requiredOLevelSubjects: ["English Language", "Literature in English"],
    minimumCredits: 5,
  },
  "Social & Management Sciences": {
    requiredUtmeSubjects: ["Mathematics", "Economics"],
    optionalUtmeSubjects: [
      "Government",
      "Geography",
      "Commerce",
      "Principles of Accounts",
      "History",
      "Literature in English",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Economics"],
    minimumCredits: 5,
  },
  // FUTA's School of Logistics and Innovation Technology (SLIT, formerly School of Management
  // Technology) — Likely, slit.futa.edu.ng. Its per-programme subject lists are mostly Uncertain,
  // so the general management/social-science rule applies for now.
  "Logistics & Innovation Technology": {
    requiredUtmeSubjects: ["Mathematics", "Economics"],
    optionalUtmeSubjects: [
      "Government",
      "Geography",
      "Commerce",
      "Principles of Accounts",
      "History",
      "Literature in English",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Economics"],
    minimumCredits: 5,
  },
  "Engineering & Technology": {
    requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"],
    optionalUtmeSubjects: ["Further Mathematics", "Technical Drawing", "Biology"],
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

const ENGLISH_MATHS_PHYSICS_CHEMISTRY = ["English Language", "Mathematics", "Physics", "Chemistry"];

// FUTA's School of Computing — filed under "Science" in this catalog, but its O'Level rule is the
// SEET/SOC one (English, Mathematics, Physics, Chemistry + 1 other science), not SOS's.
const FUTA_COMPUTING_COURSES = new Set(["Computer Science", "Cybersecurity"]);

/**
 * FUOYE's own 2025/26 programme screening requirements (ecampus.fuoye.edu.ng/putme/cutoff, plus the
 * 2026/27 table at putme.fuoye.edu.ng/utme for the Agriculture faculty and Physics) — read from
 * search-index text of the official pages, not the pages themselves. Only courses whose lists came
 * through cleanly are here; the rest keep the per-faculty template. Where FUOYE accepts one of two
 * UTME subjects (e.g. "Biology/Agriculture"), both go in optionalUtmeSubjects, because the engine
 * has no "one of" rule for UTME. O'Level "Biology or Agricultural Science" is a substitution.
 */
const SCIENCE_UTME_HEALTH: Partial<RequirementTemplate> = {
  requiredUtmeSubjects: ["Physics", "Chemistry", "Biology"],
  optionalUtmeSubjects: [],
};
const SCIENCE_UTME_PHYSICAL: Partial<RequirementTemplate> = {
  requiredUtmeSubjects: ["Mathematics", "Physics", "Chemistry"],
  optionalUtmeSubjects: [],
};
const OLEVEL_HEALTH = ["English Language", "Mathematics", "Biology", "Physics", "Chemistry"];
const OLEVEL_PHYSICAL = ["English Language", "Mathematics", "Physics", "Chemistry"];
const FUOYE_AGRICULTURE: Partial<RequirementTemplate> = {
  requiredUtmeSubjects: ["Chemistry"],
  optionalUtmeSubjects: [],
  utmeSubjectGroups: [
    ["Biology", "Agricultural Science"],
    ["Mathematics", "Physics"],
  ],
  requiredOLevelSubjects: ["English Language", "Mathematics", "Chemistry", "Physics", "Biology"],
  oLevelSubstitutions: [
    { subject: "Biology", alternatives: ["Agricultural Science"], countsTowardPoints: true },
  ],
};

const FUOYE_REQUIREMENTS: Record<string, Partial<RequirementTemplate>> = {
  Anatomy: { ...SCIENCE_UTME_HEALTH, requiredOLevelSubjects: OLEVEL_HEALTH },
  Physiology: { ...SCIENCE_UTME_HEALTH, requiredOLevelSubjects: OLEVEL_HEALTH },
  "Nursing Science": { ...SCIENCE_UTME_HEALTH, requiredOLevelSubjects: OLEVEL_HEALTH },
  "Medical Laboratory Science": { ...SCIENCE_UTME_HEALTH, requiredOLevelSubjects: OLEVEL_HEALTH },
  "Radiography and Radiation Science": {
    ...SCIENCE_UTME_HEALTH,
    requiredOLevelSubjects: OLEVEL_HEALTH,
  },
  "Civil Engineering": { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  "Mechanical Engineering": { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  "Electrical and Electronic Engineering": {
    ...SCIENCE_UTME_PHYSICAL,
    requiredOLevelSubjects: OLEVEL_PHYSICAL,
  },
  "Computer Engineering": { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  "Mechatronics Engineering": { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  "Computer Science": { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  Physics: { ...SCIENCE_UTME_PHYSICAL, requiredOLevelSubjects: OLEVEL_PHYSICAL },
  Mathematics: SCIENCE_UTME_PHYSICAL,
  Chemistry: {
    requiredUtmeSubjects: ["Chemistry", "Physics"],
    optionalUtmeSubjects: [],
    utmeSubjectGroups: [["Biology", "Mathematics"]],
  },
  Statistics: {
    requiredUtmeSubjects: ["Mathematics"],
    optionalUtmeSubjects: ["Physics", "Chemistry", "Economics"],
  },
  Biochemistry: SCIENCE_UTME_HEALTH,
  Microbiology: SCIENCE_UTME_HEALTH,
  "English and Literary Studies": {
    requiredUtmeSubjects: ["Literature in English"],
    optionalUtmeSubjects: [
      "History",
      "Government",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
      "Hausa",
      "Igbo",
      "French",
    ],
  },
  "Business Administration": {
    requiredUtmeSubjects: ["Mathematics", "Economics"],
    optionalUtmeSubjects: ["Principles of Accounts", "Commerce", "Government", "Geography"],
  },
  "Mass Communication": {
    requiredUtmeSubjects: ["Literature in English"],
    optionalUtmeSubjects: [
      "Government",
      "Commerce",
      "Economics",
      "Civic Education",
      "History",
      "Geography",
      "Christian Religious Studies",
      "Islamic Religious Studies",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Literature in English"],
  },
  // Arts, social sciences and Law — second research pass (Likely; Philosophy still Uncertain, so it
  // keeps the template). "Government or History" style rules can't be required in UTME, so both go
  // in optionalUtmeSubjects; in O'Level, History is a substitution for Government.
  Law: {
    requiredUtmeSubjects: ["Literature in English"],
    optionalUtmeSubjects: [
      "Government",
      "History",
      "Economics",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Literature in English"],
  },
  "History and International Studies": {
    requiredUtmeSubjects: ["Government"],
    optionalUtmeSubjects: [
      "History",
      "Literature in English",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
      "Igbo",
      "Geography",
      "Economics",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Government"],
    oLevelSubstitutions: [
      { subject: "Government", alternatives: ["History"], countsTowardPoints: true },
    ],
  },
  "Linguistics and Languages": {
    requiredUtmeSubjects: [],
    // "One Arts subject and two others" — at least one of these.
    utmeSubjectGroups: [
      [
        "Literature in English",
        "Yoruba",
        "Hausa",
        "Igbo",
        "French",
        "History",
        "Christian Religious Studies",
        "Islamic Religious Studies",
      ],
    ],
    optionalUtmeSubjects: [
      "Literature in English",
      "History",
      "Government",
      "Christian Religious Studies",
      "Islamic Religious Studies",
      "Yoruba",
      "Hausa",
      "Igbo",
      "French",
      "Civic Education",
      "Economics",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics"],
  },
  "Religious Studies": {
    requiredUtmeSubjects: [],
    optionalUtmeSubjects: [
      "Yoruba",
      "Igbo",
      "Hausa",
      "History",
      "Literature in English",
      "Government",
    ],
    utmeSubjectGroups: [["Christian Religious Studies", "Islamic Religious Studies"]],
    requiredOLevelSubjects: ["English Language", "Mathematics"],
  },
  Economics: {
    requiredUtmeSubjects: ["Mathematics", "Economics"],
    optionalUtmeSubjects: [
      "Government",
      "History",
      "Geography",
      "Literature in English",
      "French",
      "Christian Religious Studies",
      "Islamic Religious Studies",
    ],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Economics"],
  },
  "Political Science": {
    requiredUtmeSubjects: [],
    optionalUtmeSubjects: [
      "Mathematics",
      "Economics",
      "Geography",
      "Civic Education",
      "Literature in English",
    ],
    utmeSubjectGroups: [["Government", "History"]],
    requiredOLevelSubjects: ["English Language", "Mathematics", "Government"],
    oLevelSubstitutions: [
      { subject: "Government", alternatives: ["History"], countsTowardPoints: true },
    ],
  },
  "Animal Production and Health": FUOYE_AGRICULTURE,
  "Crop Science and Horticulture": FUOYE_AGRICULTURE,
  "Agricultural Economics and Extension": FUOYE_AGRICULTURE,
  "Soil Science and Land Resources Management": FUOYE_AGRICULTURE,
  "Fisheries and Aquaculture": FUOYE_AGRICULTURE,
  "Food Science and Technology": FUOYE_AGRICULTURE,
  "Water Resources Management and Agrometeorology": {
    ...FUOYE_AGRICULTURE,
    ...SCIENCE_UTME_PHYSICAL,
    utmeSubjectGroups: [],
  },
};

/**
 * University-specific O'Level rules from the dossier, layered over the per-faculty template:
 * - FUTA (Likely, dossier FUTA section): SOS sciences need English, Mathematics, Physics,
 *   Chemistry + Biology or Agricultural Science; SAAT agriculture needs English, Mathematics,
 *   Chemistry + Biology or Agricultural Science (+ 1 more science). Agricultural Science is a full
 *   substitute there, so it scores like Biology would.
 * - FUOYE: per-course lists from its own screening requirements — see FUOYE_REQUIREMENTS.
 * - FUNAAB (Confirmed, helpdesk.funaab.edu.ng Article ID 30): Core Sciences need English,
 *   Mathematics, Physics, Chemistry, Biology. Agriculture is accepted in lieu of Biology for
 *   eligibility but adds no O'Level points.
 */
function requirementForCourse(universityCode: string, course: CourseSeed): RequirementTemplate {
  const template = requirementFor(course.faculty);

  if (universityCode === "FUTA") {
    const biologyOrAgric: OLevelSubstitution[] = [
      { subject: "Biology", alternatives: ["Agricultural Science"], countsTowardPoints: true },
    ];
    if (course.faculty === "Science" && FUTA_COMPUTING_COURSES.has(course.name)) {
      return { ...template, requiredOLevelSubjects: ENGLISH_MATHS_PHYSICS_CHEMISTRY };
    }
    if (course.faculty === "Science") {
      return {
        ...template,
        requiredOLevelSubjects: [...ENGLISH_MATHS_PHYSICS_CHEMISTRY, "Biology"],
        oLevelSubstitutions: biologyOrAgric,
      };
    }
    if (course.faculty === "Agriculture") {
      return { ...template, oLevelSubstitutions: biologyOrAgric };
    }
    return template;
  }

  if (universityCode === "FUOYE") {
    return { ...template, ...FUOYE_REQUIREMENTS[course.name] };
  }

  if (universityCode === "FUNAAB") {
    const requiredOLevelSubjects =
      course.faculty === "Science"
        ? [...ENGLISH_MATHS_PHYSICS_CHEMISTRY, "Biology"]
        : template.requiredOLevelSubjects;
    return {
      ...template,
      requiredOLevelSubjects,
      oLevelSubstitutions: requiredOLevelSubjects.includes("Biology")
        ? [
            {
              subject: "Biology",
              alternatives: ["Agricultural Science"],
              countsTowardPoints: false,
            },
          ]
        : [],
    };
  }

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
  /** Raw JAMB (0–400) cut-off — only for courses with no published 0–100 aggregate cut-off. */
  utme?: number;
}

function c(
  name: string,
  faculty: string,
  merit: number | null,
  catchment: number | null,
  elds: number | null,
  extra?: {
    catchmentByState?: Record<string, number>;
    eldsByState?: Record<string, number>;
    utme?: number;
  },
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
    oLevelGradePoints?: Record<string, number>;
    minPostUtmePercent?: number;
    twoSittingDeductionPoints?: number;
    sittingBonus?: { oneSitting: number; twoSittings: number };
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
    scoringPolicy: {
      utmeWeighting: 50,
      postUtmeWeighting: 50,
      oLevelWeighting: 0,
      utmeMaxScore: 400,
      postUtmeMaxScore: 100,
    },
    catchmentRule: {
      // Kwara removed (user-confirmed): it is an ELDS state, already on NATIONAL_ELDS_STATES.
      // Lagos added (Likely: three secondary sources; user-approved). No official UI list found.
      catchmentStates: ["Oyo", "Ogun", "Osun", "Ondo", "Ekiti", "Lagos"],
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
  // University of Lagos — 2026/27 cut-offs ("UNILAG Releases 2026/2027 UTME Merit Cut-Off Marks",
  // unilag.edu.ng, ~16 Sep 2026), read via search-index text quoting the release and news mirrors —
  // not the page itself, so Likely at best; see docs/jamb-data-dossier.md for per-row confidence.
  // Catchment states Confirmed (Ekiti/Lagos/Ogun/Ondo/Osun/Oyo); the release gives a per-state
  // catchment figure per course (missing states fall back to merit). No ELDS figures published.
  // ============================================================================================
  {
    code: "UNILAG",
    name: "University of Lagos",
    locationState: "Lagos",
    // Likely: candidates below 12% in Post-UTME are disqualified regardless of JAMB score — see
    // docs/jamb-data-dossier.md, UNILAG section. Enforced in verifyEligibility(), not the score.
    scoringPolicy: {
      utmeWeighting: 50,
      postUtmeWeighting: 30,
      oLevelWeighting: 20,
      utmeMaxScore: 400,
      postUtmeMaxScore: 100,
      minPostUtmePercent: 12,
    },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Medicine and Surgery", "Clinical Sciences", 83.425, null, null, {
        catchmentByState: {
          Ekiti: 79.425,
          Lagos: 79.1,
          Ogun: 81.75,
          Ondo: 81.35,
          Osun: 79.825,
          Oyo: 80.05,
        },
      }),
      c("Dentistry and Dental Surgery", "Clinical Sciences", 79.025, null, null, {
        catchmentByState: {
          Ekiti: 74.575,
          Lagos: 72.725,
          Ogun: 77.3,
          Ondo: 76.325,
          Osun: 77.775,
          Oyo: 76.65,
        },
      }),
      c("Nursing Science", "Clinical Sciences", 77.925, null, null, {
        catchmentByState: {
          Ekiti: 72.775,
          Lagos: 73.95,
          Ogun: 76.275,
          Ondo: 74.875,
          Osun: 75.2,
          Oyo: 74.1,
        },
      }),
      c("Physiotherapy", "Clinical Sciences", 76, null, null, {
        catchmentByState: {
          Ekiti: 72.75,
          Lagos: 67.4,
          Ogun: 75.375,
          Ondo: 74.7,
          Osun: 73.675,
          Oyo: 72.3,
        },
      }),
      c("Medical Laboratory Science", "Clinical Sciences", 75.075, null, null, {
        catchmentByState: {
          Ekiti: 66.525,
          Lagos: 71.55,
          Ogun: 73.425,
          Ondo: 71.625,
          Osun: 74.35,
          Oyo: 69.875,
        },
      }),
      c("Pharmacy", "Clinical Sciences", 78.325, null, null, {
        catchmentByState: {
          Ekiti: 72.875,
          Lagos: 72.175,
          Ogun: 76.3,
          Ondo: 75.275,
          Osun: 75.85,
          Oyo: 74.1,
        },
      }),
      c("Law", "Law", 79.125, null, null, {
        catchmentByState: {
          Ekiti: 75.975,
          Lagos: 75.15,
          Ogun: 77.275,
          Ondo: 75.55,
          Osun: 75.25,
          Oyo: 76.35,
        },
      }),
      c("Civil Engineering", "Engineering & Technology", 74.35, null, null, {
        catchmentByState: {
          Ekiti: 62.675,
          Lagos: 69.7,
          Ogun: 71.9,
          Ondo: 67.775,
          Osun: 71.55,
          Oyo: 68.575,
        },
      }),
      c("Mechanical Engineering", "Engineering & Technology", 79.275, null, null, {
        catchmentByState: {
          Ekiti: 67.625,
          Lagos: 76.35,
          Ogun: 77.05,
          Ondo: 68.8,
          Osun: 70.525,
          Oyo: 74.325,
        },
      }),
      c("Electrical and Electronics Engineering", "Engineering & Technology", 79.025, null, null, {
        catchmentByState: {
          Ekiti: 67.925,
          Lagos: 74.625,
          Ogun: 73.975,
          Ondo: 67.7,
          Osun: 69.2,
          Oyo: 71.3,
        },
      }),
      c("Chemical Engineering", "Engineering & Technology", 72.925, null, null, {
        catchmentByState: {
          Ekiti: 62.625,
          Lagos: 63.525,
          Ogun: 70.925,
          Ondo: 67.525,
          Osun: 64.675,
          Oyo: 62.75,
        },
      }),
      c(
        "Surveying and Geoinformatics Engineering",
        "Engineering & Technology",
        66.075,
        null,
        null,
        {
          catchmentByState: {
            Ekiti: 58.075,
            Lagos: 62.5,
            Ogun: 64.35,
            Ondo: 58.875,
            Osun: 59.75,
            Oyo: 64.3,
          },
        },
      ),
      c("Metallurgical and Materials Engineering", "Engineering & Technology", 67.025, null, null, {
        catchmentByState: {
          Ekiti: 64.875,
          Lagos: 60.825,
          Ogun: 65.45,
          Ondo: 60.3,
          Osun: 59.375,
          Oyo: 60.95,
        },
      }),
      c("English", "Arts", 68.15, null, null, {
        catchmentByState: {
          Ekiti: 56.65,
          Lagos: 63.475,
          Ogun: 63.7,
          Ondo: 57.1,
          Osun: 53.475,
          Oyo: 61.325,
        },
      }),
      c("History and Strategic Studies", "Arts", 70.8, null, null, {
        catchmentByState: {
          Ekiti: 62.65,
          Lagos: 67.425,
          Ogun: 68.65,
          Ondo: 63.2,
          Osun: 64.225,
          Oyo: 66.6,
        },
      }),
      c("Philosophy", "Arts", 67.725, null, null, {
        catchmentByState: {
          Ekiti: 67.3,
          Lagos: 61.15,
          Ogun: 66.6,
          Ondo: 57.925,
          Osun: 55.5,
          Oyo: 58.15,
        },
      }),
      c("Linguistics, African and Asian Studies", "Arts", 72.575, null, null, {
        catchmentByState: {
          Ekiti: 69.525,
          Lagos: 59.575,
          Ogun: 70.6,
          Ondo: 66.425,
          Osun: 68.375,
          Oyo: 69.1,
        },
      }),
      c("Religious Studies", "Arts", 55.825, null, null), // CRS track (IRS 56.35, Osun 51.95)
      c("European Languages and Integrated Studies", "Arts", 64, null, null, {
        catchmentByState: { Lagos: 62.2, Ogun: 60.45, Oyo: 59.85 },
      }), // French track (German 69.125, Russian 55.45)
      c("Accounting", "Social & Management Sciences", 73, null, null, {
        catchmentByState: {
          Ekiti: 61.6,
          Lagos: 65.275,
          Ogun: 69.35,
          Ondo: 65.9,
          Osun: 68.625,
          Oyo: 67.85,
        },
      }),
      c("Business Administration", "Social & Management Sciences", 66.725, null, null, {
        catchmentByState: {
          Ekiti: 55.45,
          Lagos: 60.025,
          Ogun: 62.7,
          Ondo: 57.1,
          Osun: 60.25,
          Oyo: 57.175,
        },
      }),
      c("Actuarial Science and Insurance", "Social & Management Sciences", 65.875, null, null, {
        catchmentByState: {
          Ekiti: 65.575,
          Lagos: 62.925,
          Ogun: 64.175,
          Ondo: 52.3,
          Osun: 61.5,
          Oyo: 54.1,
        },
      }), // Actuarial Science track (Insurance 63.125)
      c("Banking and Finance", "Social & Management Sciences", 70.35, null, null, {
        catchmentByState: {
          Ekiti: 62.775,
          Lagos: 60.375,
          Ogun: 68.875,
          Ondo: 55.6,
          Osun: 65.925,
          Oyo: 64.275,
        },
      }),
      // Formerly "Industrial Relations and Personnel Management" (renamed before 2026/27).
      c(
        "Employment Relations and Human Resource Management",
        "Social & Management Sciences",
        66.025,
        null,
        null,
        {
          catchmentByState: {
            Ekiti: 59,
            Lagos: 54.975,
            Ogun: 64,
            Ondo: 60.125,
            Osun: 57.4,
            Oyo: 59.9,
          },
        },
      ),
      c("Economics", "Social & Management Sciences", 73.625, null, null, {
        catchmentByState: {
          Ekiti: 62.525,
          Lagos: 64.9,
          Ogun: 68.05,
          Ondo: 62.175,
          Osun: 67.35,
          Oyo: 69.35,
        },
      }),
      c("Psychology", "Social & Management Sciences", 70.15, null, null, {
        catchmentByState: {
          Ekiti: 56.975,
          Lagos: 67.125,
          Ogun: 62.95,
          Ondo: 55.8,
          Osun: 58.05,
          Oyo: 60.975,
        },
      }),
      c("Political Science", "Social & Management Sciences", 65.65, null, null, {
        catchmentByState: {
          Ekiti: 59.75,
          Lagos: 51.5,
          Ogun: 61.975,
          Ondo: 58.825,
          Osun: 51.5,
          Oyo: 55.275,
        },
      }),
      c("Computer Science", "Science", 82.05, null, null, {
        catchmentByState: {
          Ekiti: 78.4,
          Lagos: 73.225,
          Ogun: 79.175,
          Ondo: 79.675,
          Osun: 78.85,
          Oyo: 79.875,
        },
      }),
      c("Physics", "Science", 54.5, null, null),
      c("Chemistry", "Science", 65.4, null, null, {
        catchmentByState: {
          Ekiti: 62.8,
          Lagos: 59.15,
          Ogun: 61.25,
          Ondo: 55.625,
          Osun: 59.975,
          Oyo: 59.875,
        },
      }),
      c("Mathematics", "Science", 58.775, null, null, {
        catchmentByState: { Ekiti: 57.5, Lagos: 58.275, Ogun: 57.8, Osun: 55.125 },
      }),
      c("Biochemistry", "Science", 67.9, null, null, {
        catchmentByState: {
          Ekiti: 55.95,
          Lagos: 63.15,
          Ogun: 63.65,
          Ondo: 60.625,
          Osun: 64.025,
          Oyo: 57.03,
        },
      }),
      c("Botany", "Science", 54.3, null, null, {
        catchmentByState: { Lagos: 50.95 },
      }),
      c("Zoology", "Science", 54.825, null, null),
      c("Marine Sciences / Marine Biology", "Science", 64.825, null, null, {
        catchmentByState: {
          Ekiti: 54.25,
          Lagos: 54.95,
          Ogun: 60.975,
          Ondo: 50.55,
          Osun: 59.3,
          Oyo: 59.075,
        },
      }),
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
    scoringPolicy: {
      utmeWeighting: 50,
      postUtmeWeighting: 40,
      oLevelWeighting: 10,
      utmeMaxScore: 400,
      postUtmeMaxScore: 40,
    },
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
        catchmentByState: {
          Osun: 83.2,
          Ogun: 82.325,
          Ekiti: 82.175,
          Ondo: 82.175,
          Oyo: 80.5,
          Lagos: 75.75,
        },
        eldsByState: { Kwara: 77.575, Kogi: 79.05, Ebonyi: 75.1 },
      }),
      c("Dentistry / Dental Surgery", "Clinical Sciences", 80.125, 76.125, null, {
        catchmentByState: {
          Osun: 76.125,
          Ogun: 78.85,
          Ekiti: 72.725,
          Ondo: 76.45,
          Oyo: 78.45,
          Lagos: 75.25,
        },
        eldsByState: { Kwara: 71.35 },
      }),
      c("Nursing Science", "Clinical Sciences", 79.225, 77.1, null, {
        catchmentByState: {
          Osun: 77.525,
          Ogun: 77.1,
          Ekiti: 76,
          Ondo: 76.55,
          Oyo: 76.725,
          Lagos: 74.25,
        },
        eldsByState: {
          Kogi: 70.2,
          "Cross River": 70.9,
          Kwara: 70.725,
          Ebonyi: 73.225,
          Benue: 70.775,
        },
      }),
      c("Medical Rehabilitation (Physiotherapy/OT)", "Clinical Sciences", 73.5, 70.375, null, {
        catchmentByState: {
          Osun: 73.025,
          Ogun: 70.375,
          Ekiti: 71.05,
          Ondo: 69.65,
          Oyo: 72.075,
          Lagos: 67.9,
        },
        eldsByState: { Kogi: 70.775, Kano: 72.525, Kwara: 67.775, Ebonyi: 71.1 },
      }),
      // Faculty of Pharmacy
      c("Pharmacy", "Clinical Sciences", 76.15, 73.9, null, {
        catchmentByState: {
          Ekiti: 72.075,
          Lagos: 70.45,
          Ogun: 73.9,
          Ondo: 72.425,
          Osun: 74.9,
          Oyo: 73.9,
        },
        eldsByState: {
          Benue: 69.175,
          "Cross River": 69.325,
          Ebonyi: 68.375,
          Kaduna: 57.125,
          Kogi: 69.625,
          Kwara: 69.15,
        },
      }),
      // Faculty of Law
      c("Law", "Law", 75.325, 73.25, null, {
        catchmentByState: {
          Oyo: 73.95,
          Osun: 74.725,
          Ogun: 73.25,
          Ondo: 73.775,
          Ekiti: 73,
          Lagos: 69,
        },
        eldsByState: {
          Benue: 73.325,
          "Cross River": 59.3,
          Ebonyi: 67.025,
          Kwara: 73.8,
          Kogi: 74.25,
          Nasarawa: 56.425,
          Rivers: 64.325,
        },
      }),
      // Faculty of Technology
      c("Civil Engineering", "Engineering & Technology", 70.85, 62.22, 59.0, {
        catchmentByState: {
          Ekiti: 58.85,
          Lagos: 62.82,
          Ogun: 62.22,
          Ondo: 54.8,
          Osun: 69.0,
          Oyo: 69.07,
        },
      }),
      c("Mechanical Engineering", "Engineering & Technology", 72.07, 66.37, 56.0, {
        catchmentByState: {
          Ekiti: 62.6,
          Lagos: 54.87,
          Ogun: 66.37,
          Ondo: 53.92,
          Osun: 70.65,
          Oyo: 66.62,
        },
      }),
      c("Electronic and Electrical Engineering", "Engineering & Technology", 70.87, 66.72, 59.57, {
        catchmentByState: {
          Ekiti: 57.15,
          Lagos: 61.37,
          Ogun: 66.72,
          Ondo: 52.3,
          Osun: 68.15,
          Oyo: 68.07,
        },
      }),
      c("Chemical Engineering", "Engineering & Technology", 68.28, 61.15, 59.17, {
        catchmentByState: {
          Ekiti: 63.17,
          Lagos: 63.17,
          Ogun: 61.15,
          Ondo: 62.02,
          Osun: 65.72,
          Oyo: 57.95,
        },
      }),
      c(
        "Agricultural and Environmental Engineering",
        "Engineering & Technology",
        53.12,
        50.0,
        50.0,
        {
          catchmentByState: {
            Ekiti: 50.0,
            Lagos: 50.0,
            Ogun: 50.0,
            Ondo: 50.0,
            Osun: 50.0,
            Oyo: 50.0,
          },
        },
      ),
      // Faculty of Arts (catchment column order Likely Ekiti/Lagos/Ogun/Ondo/Osun/Oyo, not independently confirmed)
      c("English Language", "Arts", 64.825, 56.325, 50, {
        catchmentByState: {
          Ekiti: 63.225,
          Lagos: 60.675,
          Ogun: 56.325,
          Ondo: 56.45,
          Osun: 58.025,
          Oyo: 59.325,
        },
      }),
      c("History", "Arts", 62.625, 60.125, 50, {
        catchmentByState: {
          Ekiti: 57.475,
          Lagos: 54.2,
          Ogun: 60.125,
          Ondo: 50,
          Osun: 61.325,
          Oyo: 50,
        },
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
        catchmentByState: {
          Ekiti: 64.375,
          Lagos: 61.925,
          Ogun: 63.4,
          Ondo: 51.525,
          Osun: 62.85,
          Oyo: 53.275,
        },
      }),
      c("Music", "Arts", 51.125, 50, 50, {
        catchmentByState: { Ekiti: 50, Lagos: 50, Ogun: 50, Ondo: 50, Osun: 50, Oyo: 50 },
      }),
      // Faculty of Social Sciences
      c("Economics", "Social & Management Sciences", 65.63, 61.43, 51.93, {
        catchmentByState: {
          Osun: 63.0,
          Oyo: 59.8,
          Ekiti: 55.8,
          Ondo: 53.33,
          Lagos: 57.05,
          Ogun: 61.43,
        },
      }),
      c("Political Science", "Social & Management Sciences", 65.35, 61.15, 54.5, {
        catchmentByState: {
          Osun: 62.38,
          Oyo: 62.93,
          Ekiti: 58.35,
          Ondo: 58.15,
          Lagos: 64.15,
          Ogun: 61.15,
        },
      }),
      c("Sociology and Anthropology", "Social & Management Sciences", 52.53, 50, 50, {
        catchmentByState: { Osun: 50, Oyo: 50, Ekiti: 50, Ondo: 50, Lagos: 50, Ogun: 50 },
      }),
      // Faculty of Administration (real home of Accounting/Business Administration, per dossier)
      c("Accounting", "Social & Management Sciences", 71.67, 69.37, 51.77, {
        catchmentByState: {
          Ekiti: 68.57,
          Oyo: 70.57,
          Ogun: 69.37,
          Osun: 70.57,
          Ondo: 61.17,
          Lagos: 63.37,
        },
      }),
      c("Business Administration", "Social & Management Sciences", 65.5, 61.57, 51.57, {
        catchmentByState: {
          Ekiti: 59.27,
          Oyo: 62.0,
          Ogun: 61.57,
          Osun: 62.75,
          Ondo: 56.52,
          Lagos: 52.12,
        },
      }),
      // Faculty of Science (all courses sit at the 50 floor except Microbiology)
      c("Chemistry", "Science", 50.0, 50.0, 50.0),
      c("Physics", "Science", 50.0, 50.0, 50.0),
      c("Microbiology", "Science", 62.07, 52.4, 53.3, {
        catchmentByState: {
          Osun: 54.17,
          Oyo: 52.52,
          Ondo: 52.37,
          Ogun: 52.4,
          Lagos: 50.0,
          Ekiti: 52.82,
        },
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
  // FUTA — the 0–100 aggregates are FUTA's 2018/19 departmental cut-offs (Likely: myschool.ng
  // and two 2018–19 blog posts), re-posted every year since by Campusdesk and others under new
  // session labels; FUTA has reportedly not published departmental cut-offs since. Treat them as
  // old. Chemical/Mechatronics Engineering (created 2023), MBBS and the SLIT programmes have no
  // published 0–100 figure at all. Only the 0–100 Aggregate column is used (see SCALE NOTE) — the raw Est. JAMB column is not stored. "Law" and "Arts"
  // are excluded entirely: the dossier explicitly states no such faculty exists at FUTA.
  // Catchment/ELDS: states are Uncertain (Ondo/Ekiti/Osun/Oyo/Lagos guess) and NO cut-off numbers
  // are published anywhere for either — null for every course.
  // ============================================================================================
  {
    code: "FUTA",
    name: "Federal University of Technology, Akure",
    locationState: "Ondo",
    scoringPolicy: {
      utmeWeighting: 75,
      postUtmeWeighting: 0,
      oLevelWeighting: 25,
      utmeMaxScore: 400,
      postUtmeMaxScore: 100,
    },
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
      c(
        "Agricultural and Environmental Engineering",
        "Engineering & Technology",
        55.12,
        null,
        null,
      ),
      c("Computer Engineering", "Engineering & Technology", 69.62, null, null),
      c("Industrial and Production Engineering", "Engineering & Technology", 47.5, null, null),
      c("Metallurgical and Materials Engineering", "Engineering & Technology", 54.87, null, null),
      c("Mining Engineering", "Engineering & Technology", 54.75, null, null),
      c("Mechatronics Engineering", "Engineering & Technology", null, null, null),
      c("Business Information Technology", "Logistics & Innovation Technology", null, null, null),
      c(
        "Entrepreneurship Management Technology",
        "Logistics & Innovation Technology",
        null,
        null,
        null,
      ),
      c(
        "Logistics and Transport Technology",
        "Logistics & Innovation Technology",
        null,
        null,
        null,
      ),
      c("Project Management Technology", "Logistics & Innovation Technology", null, null, null),
      c("Procurement Management Technology", "Logistics & Innovation Technology", null, null, null),
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
  // FUNAAB — formula Confirmed (helpdesk.funaab.edu.ng, Article ID 30): straight 50% UTME + 50%
  // O'Level, NO Post-UTME/screening term at all (FUNAAB runs an online screening exercise, but
  // it's an eligibility/verification step, not a scored component — postUtmeWeighting: 0).
  // O'Level grade table is FUNAAB-specific too (A1=6..C6=1, max 30, vs. the engine's generic
  // A1=10..C6=5, max 50) — see oLevelGradePoints below and resolveGradePointsTable() in engine.ts.
  //
  // meritCutOff is null for every course here on purpose, NOT a gap: FUNAAB's live portal
  // publishes raw 0–400 JAMB floors per course, but the Confirmed formula produces a 0–100
  // aggregate. Those two numbers are not the same thing, so the floor is stored as utmeCutOff and
  // compared against the candidate's UTME score — see the SCALE NOTE at the top of this file.
  // "Law" and "Arts" excluded: the dossier states neither faculty exists at FUNAAB.
  // Catchment states Confirmed (Ogun/Oyo/Osun/Ondo/Ekiti/Lagos); no catchment/ELDS cut-off
  // numbers are published anywhere — null for every course.
  // ============================================================================================
  {
    code: "FUNAAB",
    name: "Federal University of Agriculture, Abeokuta",
    locationState: "Ogun",
    scoringPolicy: {
      utmeWeighting: 50,
      postUtmeWeighting: 0,
      oLevelWeighting: 50,
      utmeMaxScore: 400,
      postUtmeMaxScore: 100,
      // Confirmed, helpdesk.funaab.edu.ng Article ID 30: A1=6, B2=5, B3=4, C4=3, C5=2, C6=1, D7-F9=0.
      oLevelGradePoints: { A1: 6, B2: 5, B3: 4, C4: 3, C5: 2, C6: 1, D7: 0, E8: 0, F9: 0 },
      // Same source: two O'Level results (WAEC + NECO) — best grade per subject, minus 1 point.
      twoSittingDeductionPoints: 1,
    },
    catchmentRule: {
      catchmentStates: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti", "Lagos"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Veterinary Medicine (DVM)", "Clinical Sciences", null, null, null, { utme: 200 }),
      c("Agricultural Engineering", "Engineering & Technology", null, null, null, { utme: 200 }),
      c("Civil Engineering", "Engineering & Technology", null, null, null, { utme: 200 }),
      c("Electrical and Electronics Engineering", "Engineering & Technology", null, null, null, {
        utme: 200,
      }),
      c("Mechanical Engineering", "Engineering & Technology", null, null, null, { utme: 200 }),
      c("Mechatronic Engineering", "Engineering & Technology", null, null, null, { utme: 200 }),
      c(
        "Agricultural Economics and Farm Management",
        "Social & Management Sciences",
        null,
        null,
        null,
        { utme: 160 },
      ),
      c(
        "Agricultural Extension and Rural Development",
        "Social & Management Sciences",
        null,
        null,
        null,
        { utme: 160 },
      ),
      c("Agricultural Administration", "Social & Management Sciences", null, null, null, {
        utme: 160,
      }),
      c("Cooperative Studies", "Social & Management Sciences", null, null, null, { utme: 160 }),
      c("Development Studies", "Social & Management Sciences", null, null, null, { utme: 160 }),
      c("Accounting", "Social & Management Sciences", null, null, null, { utme: 200 }),
      c("Banking and Finance", "Social & Management Sciences", null, null, null, { utme: 200 }),
      c("Business Administration", "Social & Management Sciences", null, null, null, { utme: 200 }),
      c("Economics", "Social & Management Sciences", null, null, null, { utme: 200 }),
      c("Computer Science", "Science", null, null, null, { utme: 200 }),
      c("Physics", "Science", null, null, null, { utme: 200 }),
      c("Chemistry", "Science", null, null, null, { utme: 180 }),
      c("Biochemistry", "Science", null, null, null, { utme: 200 }),
      c("Microbiology", "Science", null, null, null, { utme: 200 }),
      c("Mathematics", "Science", null, null, null, { utme: 200 }),
      c("Statistics", "Science", null, null, null, { utme: 200 }),
      c("Cyber Security", "Science", null, null, null, { utme: 200 }),
      c("Data Science", "Science", null, null, null, { utme: 200 }),
      c("Information Technology", "Science", null, null, null, { utme: 200 }),
      c("Software Engineering", "Science", null, null, null, { utme: 200 }),
      c("Animal Production and Health", "Agriculture", null, null, null, { utme: 160 }),
      c("Crop Protection", "Agriculture", null, null, null, { utme: 160 }),
      c("Soil Science and Land Management", "Agriculture", null, null, null, { utme: 160 }),
      c("Aquaculture and Fisheries Management", "Agriculture", null, null, null, { utme: 160 }),
      c("Forest Resource Management", "Agriculture", null, null, null, { utme: 160 }),
      c("Animal Breeding and Genetics", "Agriculture", null, null, null, { utme: 160 }),
      c("Plant Breeding and Seed Technology", "Agriculture", null, null, null, { utme: 160 }),
      c("Horticulture", "Agriculture", null, null, null, { utme: 160 }),
      c("Wildlife and Eco-tourism Management", "Agriculture", null, null, null, { utme: 160 }),
    ],
  },

  // ============================================================================================
  // FUOYE — cut-offs are its 2025/26 Post-UTME departmental cut-offs (0–100), from
  // news.fuoye.edu.ng "FUOYE releases 2025/2026 Post-UTME screening cut-off marks", read via
  // search-index text quoting that page, not the page itself. Most rows Likely; engineering and
  // the physical/life sciences Uncertain — see docs/jamb-data-dossier.md. One cut-off per course
  // (no separate catchment/ELDS figures). Law is not admitting for 2026/27.
  // Catchment states Likely (Ekiti/Ondo/Osun/Oyo); no catchment/ELDS cut-off numbers published —
  // null for every course.
  // O'Level grade table: Likely, A1=6..C6=1 (max 30) - NOT the engine's generic A1=10..C6=5 (max
  // 50). The 10%-sitting-bonus component (10pts one sitting, 6pts two) is scoringPolicy.sittingBonus.
  // ============================================================================================
  {
    code: "FUOYE",
    name: "Federal University Oye-Ekiti",
    locationState: "Ekiti",
    scoringPolicy: {
      utmeWeighting: 60,
      postUtmeWeighting: 0,
      oLevelWeighting: 30,
      utmeMaxScore: 400,
      postUtmeMaxScore: 100,
      oLevelGradePoints: { A1: 6, B2: 5, B3: 4, C4: 3, C5: 2, C6: 1, D7: 0, E8: 0, F9: 0 },
      // Likely: 10 points for one sitting, 6 for two — the remaining 10% of FUOYE's formula.
      sittingBonus: { oneSitting: 10, twoSittings: 6 },
    },
    catchmentRule: {
      catchmentStates: ["Ekiti", "Ondo", "Osun", "Oyo"],
      eldsStates: NATIONAL_ELDS_STATES,
      meritQuotaPercent: 45,
      catchmentQuotaPercent: 35,
      eldsQuotaPercent: 20,
    },
    courses: [
      c("Anatomy", "Clinical Sciences", 66.15, null, null),
      c("Physiology", "Clinical Sciences", 65.8, null, null),
      c("Nursing Science", "Clinical Sciences", 78.55, null, null),
      c("Medical Laboratory Science", "Clinical Sciences", 75.7, null, null),
      c("Radiography and Radiation Science", "Clinical Sciences", 74.05, null, null),
      // 77.75 is FUOYE's 2025/26 Law departmental cut-off (Confirmed, news.fuoye.edu.ng). FUOYE is
      // not admitting into Law for 2026/27 (Confirmed, putme.fuoye.edu.ng).
      c("Law", "Law", 77.75, null, null),
      c("Civil Engineering", "Engineering & Technology", 66.25, null, null),
      c("Mechanical Engineering", "Engineering & Technology", 66.4, null, null),
      c("Electrical and Electronic Engineering", "Engineering & Technology", 66, null, null),
      c("Computer Engineering", "Engineering & Technology", 65.9, null, null),
      c("Mechatronics Engineering", "Engineering & Technology", 69.85, null, null),
      c("English and Literary Studies", "Arts", 66.35, null, null),
      c("History and International Studies", "Arts", 67.9, null, null),
      c("Linguistics and Languages", "Arts", 63.7, null, null),
      c("Philosophy", "Arts", 60.35, null, null),
      c("Religious Studies", "Arts", 52.95, null, null),
      c("Economics", "Social & Management Sciences", 64.55, null, null),
      c("Political Science", "Social & Management Sciences", 67.05, null, null),
      c("Accounting", "Social & Management Sciences", 71.25, null, null),
      c("Business Administration", "Social & Management Sciences", 66.05, null, null),
      c("Mass Communication", "Social & Management Sciences", 68.5, null, null),
      c("Computer Science", "Science", 69.2, null, null),
      c("Biochemistry", "Science", 64.4, null, null),
      c("Microbiology", "Science", 63.95, null, null),
      c("Physics", "Science", 54.4, null, null),
      c("Chemistry", "Science", 56.55, null, null),
      c("Mathematics", "Science", 56.85, null, null),
      c("Statistics", "Science", 54.8, null, null),
      c("Animal Production and Health", "Agriculture", 58.1, null, null),
      c("Crop Science and Horticulture", "Agriculture", 57.3, null, null),
      c("Agricultural Economics and Extension", "Agriculture", 57.6, null, null),
      c("Soil Science and Land Resources Management", "Agriculture", 52.4, null, null),
      c("Fisheries and Aquaculture", "Agriculture", 57.3, null, null),
      c("Food Science and Technology", "Agriculture", 60.95, null, null),
      c("Water Resources Management and Agrometeorology", "Agriculture", 52.9, null, null),
    ],
  },
];

/**
 * Courses renamed since an earlier seed. Renaming the existing row (instead of upserting a new one)
 * keeps one row per course and keeps old assessment reports pointing at it.
 */
const COURSE_RENAMES: { universityCode: string; from: string; to: string }[] = [
  {
    universityCode: "UNILAG",
    from: "Industrial Relations and Personnel Management",
    to: "Employment Relations and Human Resource Management",
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

    for (const rename of COURSE_RENAMES.filter((r) => r.universityCode === uni.code)) {
      const [old, current] = await Promise.all([
        prisma.course.findUnique({
          where: { universityId_name: { universityId: university.id, name: rename.from } },
        }),
        prisma.course.findUnique({
          where: { universityId_name: { universityId: university.id, name: rename.to } },
        }),
      ]);
      if (old && !current)
        await prisma.course.update({ where: { id: old.id }, data: { name: rename.to } });
    }

    for (const course of uni.courses) {
      const courseData = {
        faculty: course.faculty,
        meritCutOff: course.merit,
        catchmentCutOff: course.catchment,
        eldsCutOff: course.elds,
        catchmentCutOffByState: course.catchmentByState ?? undefined,
        eldsCutOffByState: course.eldsByState ?? undefined,
        utmeCutOff: course.utme ?? null,
      };

      const courseRow = await prisma.course.upsert({
        where: { universityId_name: { universityId: university.id, name: course.name } },
        update: courseData,
        create: { universityId: university.id, name: course.name, ...courseData },
      });

      const template = requirementForCourse(uni.code, course);
      const requirement = {
        ...template,
        utmeSubjectGroups: template.utmeSubjectGroups ?? [],
        oLevelSubstitutions: template.oLevelSubstitutions ?? [],
      };
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
