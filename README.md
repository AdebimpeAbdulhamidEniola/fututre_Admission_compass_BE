# PlaceRight Backend

Express.js backend for [PlaceRight](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass) — a decision-support system for university admission placement in Nigeria. This repo implements the contract already defined by the frontend (`src/types/domain.ts`, `src/lib/http.ts`, and the endpoint list in that repo's README).

Being built stage by stage per [`docs/backend-implementation-plan.md`](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass/blob/main/docs/backend-implementation-plan.md) in the frontend repo.

**Done so far:**
- **Stage 0 — project scaffold.** Express app that boots, error envelope wired, health check.
- **Stage 1 — data layer.** Postgres via Prisma. Schema mirrors `domain.ts` (`University`, `Course`, `AdmissionRequirement`, `ScoringPolicy`, `CatchmentRule`, `CandidateProfile`, `AssessmentReport`, `User`, `AdminLogEntry`, `EvaluationEvent`). Seed script loads all 6 universities and the **full 210-course catalog** (35 per university), transcribed directly from `docs/jamb-data-dossier.md` — see "Seed data" below for what's confirmed vs. genuinely unknown, and why `meritCutOff`/`catchmentCutOff`/`eldsCutOff` are nullable.
- **Stage 2 — auth.** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, JWT-based, bcrypt password hashing, `requireAuth`/`requireAdmin` middleware.
- **Stage 3 — public catalog endpoints.** `GET /universities`, `/universities/:id/courses`, `/universities/:id/scoring-policy`, `/universities/:id/catchment-rule`, `/courses/:id/requirements` — all public, no auth. 404s via the standard envelope for unknown IDs.
- **Stage 4 — candidate profile + the assessment engine.** `POST /candidates/profile`, `GET`/`PATCH /candidates/me`, `POST /eligibility/verify`, `/scoring/aggregate`, `/catchment/classify`, `/recommendations`, `/assessments`, `GET /assessments`, `/assessments/:id`. The engine (`src/modules/assessment/engine.ts`) is a straight port of the frontend's `src/mocks/engine.ts` onto Postgres — see "Assessment engine" below for the details worth knowing before touching it.
- **Stage 5 — admin CRUD.** `GET/POST/PATCH/DELETE` for `/admin/universities`, `/admin/courses`, `/admin/requirements`, `/admin/scoring-policies`, `/admin/catchment-rules` — all behind `requireAuth` + `requireAdmin`, each mutation writing an `AdminLogEntry` (`src/modules/admin/admin.routes.ts`, `admin.service.ts`).
- **Stage 6 — metrics/evaluation dashboard.** `GET /admin/metrics`, `/admin/logs`, `/admin/evaluation-events` (paginated, filterable by module/outcome/date) — computed from real `AssessmentReport`/`EvaluationEvent`/`AdminLogEntry` rows (`src/modules/admin/metrics.service.ts`). `precision`/`recall`/`accuracy`/`recommenderConfusionMatrix` are the Decision Tree recommender's scores on its held-out test split (see "ML recommender" below).
- **Stage 8 — the ML Decision Tree course recommender.** `src/modules/recommender/` — see "ML recommender" below.

## Getting started

Requires a Postgres database (a free tier on Neon/Supabase/Railway works fine, or run one locally).

```sh
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to your Postgres instance, and JWT_SECRET to `openssl rand -hex 32`

npm run db:migrate   # creates/updates the schema (prompts for a migration name) — re-run after every pull that changes prisma/schema.prisma
npm run db:seed      # loads the 6 universities + full 210-course catalog
npm run ml:train     # trains the Decision Tree recommender (optional — the server trains one on startup if it's missing)

npm run dev
```

```sh
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}

curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Ada Lovelace","email":"ada@example.com","phone":"08012345678","password":"correcthorsebatterystaple"}'
# {"accessToken":"...","user":{"id":"...","fullName":"Ada Lovelace","email":"ada@example.com","phone":"08012345678","role":"CANDIDATE"}}

curl http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken from above>"
# {"id":"...","fullName":"Ada Lovelace", ...}

curl http://localhost:3000/nonexistent
# {"statusCode":404,"message":"Cannot GET /nonexistent","error":"Not Found"}
```

## Scripts

- `npm run dev` — start with hot reload (tsx watch)
- `npm run build` — compile to `dist/`
- `npm start` — run the compiled build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` / `npm run format`
- `npm run db:migrate` — apply Prisma schema migrations (dev)
- `npm run db:seed` — run `prisma/seed.ts`
- `npm run db:studio` — Prisma's DB browser GUI
- `npm run ml:evaluate -- <file.csv>` — test the saved model on an unseen dataset of candidates with known admission outcomes (format: `data/unseen-dataset-template.csv`, documented in `src/modules/recommender/evaluate.cli.ts`); prints model vs. rule-baseline accuracy/precision/recall and saves `models/unseen-evaluation.json`
- `npm run ml:train` — regenerate the synthetic dataset, retrain the recommender, print its test metrics, and save `models/recommender-model.json` + `models/synthetic-dataset.json` (restart the server afterwards)

## Error envelope

Every non-2xx response is `{ statusCode, message, error }` (`message` can be a string or a string array), matching what the frontend's `http.ts` already expects. Throw an `ApiError` (see `src/lib/errors.ts`) from any route handler or middleware and the global error handler (`src/middleware/error-handler.ts`) takes care of the rest — no per-route try/catch needed for expected errors.

```ts
import { notFound } from "../lib/errors.js";

router.get("/courses/:id", (req, res) => {
  const course = findCourse(req.params.id);
  if (!course) throw notFound("Course");
  res.json(course);
});
```

Async route handlers must be wrapped in `asyncHandler` (`src/lib/async-handler.ts`) — Express 4 doesn't catch rejected promises on its own, so an unwrapped async handler that throws will hang the request instead of reaching the error handler. See `src/modules/auth/auth.routes.ts` for the pattern.

## Auth

- `POST /auth/register` — `{ fullName, email, phone, password }` → `AuthSession`. Always creates a `CANDIDATE`; there's no public admin-signup endpoint (matches the contract). Promote a user to `ADMIN` directly in the database, or via `npm run db:studio`.
- `POST /auth/login` — `{ email, password }` → `AuthSession`.
- `GET /auth/me` — requires `Authorization: Bearer <token>` → `AuthUser`.
- `requireAuth` / `requireAdmin` (`src/modules/auth/auth.middleware.ts`) — use on any route that needs a signed-in user or an admin specifically.

## Assessment engine

`src/modules/assessment/engine.ts` ports `verifyEligibility`, `classifyCatchment`, `computeAggregate`, `recommendCourses`, and `buildAssessmentContext` from the frontend's `src/mocks/engine.ts` — the reference implementation — replacing its in-memory `.find()` lookups with Prisma queries. Keep the two in lockstep; if the frontend's engine changes, port the change here too.

**Every Stage 4 engine endpoint takes the full candidate profile inline in the request body** (`{ candidate: {...} }`), not a reference to a saved `CandidateProfile` row — this matches the frontend's existing contract exactly (`src/lib/api/eligibility.ts` etc. all send `{ candidate: CandidateProfile }`). `POST /candidates/profile` and the engine endpoints are therefore mostly independent: a candidate can call `/eligibility/verify` with a draft profile they haven't saved yet.

**`POST /assessments` is the one place a real, saved `CandidateProfile` is required** — it persists an `AssessmentReport` tied to the authenticated user's own profile (looked up server-side by `req.user.id`, never trusting the client-supplied `candidate.id` for that link), and 400s with a clear message if the user hasn't created one yet via `POST /candidates/profile`.

**Rules worth knowing before touching the engine:**
- **Eligibility** (`verifyEligibility`) 400s when the course has no `AdmissionRequirement` — passing a candidate against an empty rule base would be a silent false "eligible" (Use Case 2's exception). O'Level results are merged to the best grade per subject first. A required subject can be satisfied by an alternative listed in `AdmissionRequirement.oLevelSubstitutions` (FUNAAB: Agriculture for Biology, scored as zero; FUTA SOS/SAAT: Biology or Agricultural Science), reported as an `OLEVEL_SUBSTITUTE_USED` warning.
- **O'Level score** always covers 5 subjects: the course's required ones, then the candidate's best other results if it names fewer than 5. `CandidateProfile.oLevelSittings === 2` costs `ScoringPolicy.twoSittingDeductionPoints` (FUNAAB: 1).
- **Post-UTME**: `POST /scoring/aggregate` 422s only when the university's formula has a Post-UTME term (`postUtmeWeighting > 0`) and the candidate has no score; `POST /assessments` stores `score: null` in that case instead. FUNAAB/FUTA/FUOYE score without one.
- **Sitting bonus**: `ScoringPolicy.sittingBonus` (FUOYE: 10 for one sitting, 6 for two) is added as a `SITTING_BONUS` breakdown component.
- **Which cut-off applies** (`resolveApplicableCutOff`): catchment/ELDS candidates are considered for merit places first, so clearing the merit cut-off is enough; otherwise their own status's cut-off applies, falling back to merit when no separate figure is published. A course with no 0–100 cut-off but a raw JAMB `Course.utmeCutOff` (all of FUNAAB) is judged on the candidate's UTME score — `AggregateScoreResult.cutOffBasis` is then `"UTME"`. With neither, `computeAggregate`/`buildAssessmentContext` 400 rather than comparing against 0.
- `computeAggregate`/`buildAssessmentContext` 400 if `targetCourseId`/`targetUniversityId` don't resolve to real, matching rows.
- **Admin**: creating/updating a scoring policy 400s unless UTME + Post-UTME + O'Level weightings (+ the sitting bonus) total 100%.

**Per-state catchment/ELDS cut-offs**: `resolveCutOff()` looks up the candidate's matched state in `Course.catchmentCutOffByState`/`eldsCutOffByState` before falling back to the flat `catchmentCutOff`/`eldsCutOff` — see "Data model notes" below.

## ML recommender

`src/modules/recommender/` (thesis Objective 3):
- **When it runs**: only for a candidate who passed the subject/O'Level checks for their chosen course but scored below its cut-off. Otherwise `recommendations` is `[]`.
- **What it ranks**: other courses **at the same university** that the candidate is also eligible for (universities differ in formulas and cut-offs), scored with that university's formula. Top 8 by the model's admission probability. Each `CourseRecommendation` carries `candidateScore`, `cutOffBasis`, and `lowConfidence` (the course had fewer than 5 training rows — Use Case 4's "insufficient historical data").
- **Training data** (`synthetic-data.ts`): 2,000 seeded synthetic candidate profiles, each checked against 2 random eligible courses from the seeded catalog with the live engine, and labelled admitted with probability `1 / (1 + e^(-margin / 2.5))` over that course's published cut-off. Deterministic for a given catalog.
- **Model** (`model.ts`): ml-cart `DecisionTreeClassifier` (gini, max depth 8, min 10 samples per node) on 11 features (UTME/Post-UTME/O'Level percents, aggregate, cut-off, margin, catchment status, cut-off basis, sittings, university, faculty), 80/20 train/test split. The saved file holds the tree, the test accuracy/precision/recall/confusion matrix (shown on the admin metrics dashboard), and rows per course.
- **Loading**: the server loads `RECOMMENDER_MODEL_PATH` (default `models/recommender-model.json`) at startup, training and saving one if it's missing. Run `npm run ml:train` after re-seeding or changing cut-offs, then restart.
- **Unseen-data evaluation**: `npm run ml:evaluate -- <file.csv>` runs the saved model on real or independently collected candidates (not used in training). Rows the candidate isn't eligible for, or with no cut-off, are skipped with a reason. Report these metrics alongside the synthetic test-split ones.
- **Storage**: every recommendation is also written to the `Recommendation` table (candidate, suggested course, rank, match probability), linked to its `AssessmentReport`.

Every engine call is wrapped in `withEvaluationLog()` (`src/modules/assessment/evaluation-logger.ts`), writing an `EvaluationEvent` row (module, outcome, latency) as required by the implementation plan — this feeds the Stage 6 metrics dashboard.

## Seed data

`prisma/seed.ts` loads the **full 210-course catalog** (35 per university), transcribed directly from `docs/jamb-data-dossier.md` in the frontend repo. Every figure traces to that document — nothing here is invented. Read the seed script's own header comment before changing any number in it; the summary:

- **`Course.meritCutOff` / `catchmentCutOff` / `eldsCutOff` are nullable.** Where the dossier has no confirmed figure for a course (marked "—" — e.g. FUTA's Chemical Engineering, several "estimate only" rows), the field is `null`, not a guessed number. A null catchment/ELDS figure falls back to the merit cut-off; `computeAggregate()` throws a clear 400 only when no cut-off at all applies, and the recommender just skips such courses.
- **Scale consistency**: `computeAggregate()` always produces a 0–100 aggregate, so cut-offs must be on that same scale to compare sensibly.
  - UI, UNILAG, OAU: dossier gives a native 0–100 aggregate — used as-is.
  - FUTA, FUOYE: dossier gives both a 0–100 aggregate and a separate raw-JAMB "estimated" figure — only the 0–100 aggregate is stored.
  - **FUNAAB**: the dossier's only published cut-off is the raw 0–400 JAMB floor (160–200), not a 0–100 aggregate. Comparing a 0–100 aggregate against a 0–400 number would silently fail every candidate, so `meritCutOff` is `null` for all 35 FUNAAB courses and the raw floor is stored in `Course.utmeCutOff` instead: FUNAAB candidates are judged on their UTME score against it, and still shown their 0–100 aggregate. Don't "fix" this by inventing a conversion factor.
  - **FUNAAB's O'Level grading is also different from every other university**: its Confirmed formula (helpdesk.funaab.edu.ng, Article ID 30) uses A1=6, B2=5, B3=4, C4=3, C5=2, C6=1 (max 30 across 5 subjects), not the engine's generic A1=10..C6=5 (max 50) table. `ScoringPolicy.oLevelGradePoints` (nullable JSON) carries a per-university override; `resolveGradePointsTable()` in `engine.ts` falls back to the generic table when it's `null`, and normalizes by each table's own max so the resulting percentage is correct either way. Only FUNAAB has a confirmed override so far. FUNAAB's two other O'Level rules are modeled too: best WAEC/NECO grade per subject with a 1-point deduction (`ScoringPolicy.twoSittingDeductionPoints`), and Agriculture in lieu of Biology for eligibility at zero points (`AdmissionRequirement.oLevelSubstitutions`). Its Core Sciences courses require English, Mathematics, Physics, Chemistry and Biology.
  - **FUNAAB does not have a Post-UTME/screening scoring component** — `postUtmeWeighting: 0`. It does run an online screening exercise, but per the Confirmed formula that's an eligibility/verification step, not something that contributes to the aggregate.
- **Excluded, not fabricated**: FUTA and FUNAAB's dossier tables include "Law"/"Arts" rows that just state those faculties don't exist — those two rows per university are not seeded as courses. FUOYE's Law *is* seeded (aggregate cut-off `null`) despite the dossier's open question over whether that faculty exists at all.
- **`Course.catchmentCutOffByState` / `eldsCutOffByState`** (JSON) hold real per-state cut-off overrides for UNILAG (all courses, 2026/27 release) and OAU (all 35 courses, from OAU's own faculty documents) — see the dossier's UNILAG/OAU sections for why a single flat number per course doesn't match what these universities actually publish. Falls back to `catchmentCutOff`/`eldsCutOff` when a state isn't present in the map.
- **`AdmissionRequirement` uses one template per faculty** (`REQUIREMENT_TEMPLATES` in the seed script), adjusted per university where the dossier says so (`requirementForCourse()`: FUTA's per-school O'Level rules, FUNAAB's Core Sciences rule and Agriculture-for-Biology substitution), not a hand-crafted subject list per course — the dossier documents a general per-stream O'Level/UTME rule rather than an exact combination for most of the 210 courses, so applying it uniformly is the honest choice. The one exception: FUOYE has its own detailed per-course admission-requirements document (see the dossier's FUOYE section) that's more granular than this template approach — worth revisiting once that's transcribed.

## Data model notes

- `AssessmentReport` stores `VerificationResult` / `AggregateScoreResult` / `CatchmentResult` / `CourseRecommendation[]` / `AssessmentContext` as JSON rather than five more tables — those shapes are read-mostly, per-candidate, and never queried by their internal fields.

## What's not done yet

Waiting on data (the code already handles it once the figures are in — via the seed script or admin CRUD):
- **FUOYE's per-course admission requirements** — its own admission-requirements document is the authoritative source for `AdmissionRequirement` per course; not transcribed yet, so FUOYE still uses the per-faculty templates.
- **UI's catchment/ELDS states** — now Oyo, Ogun, Osun, Ondo, Ekiti, Lagos (Likely, secondary sources; Kwara moved to ELDS). No official UI list found yet.
- **UNILAG 2026/27 cut-offs** are from search-index text of the release, not the page itself — several rows are Uncertain (see the dossier's UNILAG section).
- **Missing cut-offs** — FUTA Chemical Engineering, Mechatronics Engineering, MBBS and the five School of Logistics and Innovation Technology courses (FUTA hasn't published 0–100 departmental cut-offs for them).
- **Open questions in the dossier** — FUTA's disputed formula (kept as 75% UTME + 25% O'Level, no Post-UTME).

Not started:
- **Stage 7 — hardening** (rate limiting, load testing) and automated tests.

## Folder layout

```
prisma/
  schema.prisma       Data model — mirrors domain.ts in the frontend repo
  seed.ts             Seed script — 6 universities, full 210-course catalog
src/
  app.ts              Express app wiring (middleware, routers, error handler)
  server.ts           entrypoint — starts the HTTP listener, graceful shutdown
  config/
    env.ts            env loading + validation
  db/
    client.ts          shared PrismaClient instance
  lib/
    errors.ts          ApiError + helpers (notFound, badRequest, unauthorized, forbidden)
    async-handler.ts   wraps async route handlers so rejections reach the error handler
    jwt.ts              sign/verify access tokens
    validate.ts         zod schema → parsed input or a 400 ApiError
  middleware/
    error-handler.ts   global error handler + 404 handler
  modules/
    health/            GET /health
    auth/               register, login, me, requireAuth, requireAdmin
    catalog/            GET /universities, /universities/:id/courses, .../scoring-policy,
                        .../catchment-rule, /courses/:id/requirements — all public
    assessment/         the engine (verify/classify/score/recommend/context), evaluation
                        logging, the candidate-profile zod schema shared across these routes,
                        and the eligibility/scoring/catchment/recommendations routers
    candidates/         POST /candidates/profile, GET/PATCH /candidates/me
    assessments/        POST/GET /assessments, GET /assessments/:id — persists AssessmentReport
    admin/              admin CRUD (universities/courses/requirements/scoring-policies/
                        catchment-rules) + metrics/logs/evaluation-events (Stage 5/6)
    recommender/        Stage 8 — synthetic dataset, ml-cart Decision Tree, ranking,
                        Recommendation rows, `npm run ml:train` CLI
  types/
    express.d.ts        augments Express's Request with `user?: AuthUser`
```

## Roadmap

See the frontend repo's `docs/backend-implementation-plan.md` for the full plan and `docs/jamb-data-dossier.md` for the seed-data specification. Stages 0–6 and 8 are done; what's left is the data listed under "What's not done yet" and Stage 7 hardening.
