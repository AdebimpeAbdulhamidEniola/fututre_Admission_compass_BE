# PlaceRight Backend

Express.js backend for [PlaceRight](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass) — a decision-support system for university admission placement in Nigeria. This repo implements the contract already defined by the frontend (`src/types/domain.ts`, `src/lib/http.ts`, and the endpoint list in that repo's README).

Being built stage by stage per [`docs/backend-implementation-plan.md`](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass/blob/main/docs/backend-implementation-plan.md) in the frontend repo.

**Done so far:**
- **Stage 0 — project scaffold.** Express app that boots, error envelope wired, health check.
- **Stage 1 — data layer.** Postgres via Prisma. Schema mirrors `domain.ts` (`University`, `Course`, `AdmissionRequirement`, `ScoringPolicy`, `CatchmentRule`, `CandidateProfile`, `AssessmentReport`, `User`, `AdminLogEntry`, `EvaluationEvent`). Seed script loads all 6 universities and the **full 210-course catalog** (35 per university), transcribed directly from `docs/jamb-data-dossier.md` — see "Seed data" below for what's confirmed vs. genuinely unknown, and why `meritCutOff`/`catchmentCutOff`/`eldsCutOff` are nullable.
- **Stage 2 — auth.** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, JWT-based, bcrypt password hashing, `requireAuth`/`requireAdmin` middleware.
- **Stage 3 — public catalog endpoints.** `GET /universities`, `/universities/:id/courses`, `/universities/:id/scoring-policy`, `/universities/:id/catchment-rule`, `/courses/:id/requirements` — all public, no auth. 404s via the standard envelope for unknown IDs.
- **Stage 4 — candidate profile + the assessment engine.** `POST /candidates/profile`, `GET`/`PATCH /candidates/me`, `POST /eligibility/verify`, `/scoring/aggregate`, `/catchment/classify`, `/recommendations`, `/assessments`, `GET /assessments`, `/assessments/:id`. The engine (`src/modules/assessment/engine.ts`) is a straight port of the frontend's `src/mocks/engine.ts` onto Postgres — see "Assessment engine" below for the details worth knowing before touching it.

## Getting started

Requires a Postgres database (a free tier on Neon/Supabase/Railway works fine, or run one locally).

```sh
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to your Postgres instance, and JWT_SECRET to `openssl rand -hex 32`

npm run db:migrate   # creates the schema (prompts for a migration name the first time)
npm run db:seed      # loads the 6 universities + starter course subset

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

**Deliberate deviations from the mock, all documented inline in the code:**
- `POST /scoring/aggregate` 422s whenever `candidate.postUtmeScore === null`, matching the frontend's exact (slightly stale) API-layer rule — even for FUNAAB/FUTA/FUOYE, whose real formulas (per `docs/jamb-data-dossier.md`) don't actually have a Post-UTME component at all. Not fixed here; that's a frontend-contract inaccuracy, not something to unilaterally change server-side.
- `POST /assessments` instead treats a null `postUtmeScore` as "can't score yet" and stores `score: null` — no error — exactly mirroring `src/lib/api/assessments.ts`'s mock behavior, which differs from the scoring endpoint's.
- `computeAggregate`/`buildAssessmentContext` 400 if `targetCourseId`/`targetUniversityId` don't resolve to real, matching rows — the mock silently returned a zeroed-out result instead, which isn't a good look for a real API.
- `computeAggregate`/`buildAssessmentContext` also 400 if the resolved cut-off itself is `null` (the dossier has no confirmed figure for that course/status — see "Seed data" below) — again, refusing clearly rather than silently comparing against 0. `recommendCourses` instead just skips courses with a `null` cut-off, since one missing figure shouldn't break the whole recommendation list.

**Per-state catchment/ELDS cut-offs**: `resolveCutOff()` looks up the candidate's matched state in `Course.catchmentCutOffByState`/`eldsCutOffByState` before falling back to the flat `catchmentCutOff`/`eldsCutOff` — see "Data model notes" below.

Every engine call is wrapped in `withEvaluationLog()` (`src/modules/assessment/evaluation-logger.ts`), writing an `EvaluationEvent` row (module, outcome, latency) as required by the implementation plan — this feeds the Stage 6 metrics dashboard.

## Seed data

`prisma/seed.ts` loads the **full 210-course catalog** (35 per university), transcribed directly from `docs/jamb-data-dossier.md` in the frontend repo. Every figure traces to that document — nothing here is invented. Read the seed script's own header comment before changing any number in it; the summary:

- **`Course.meritCutOff` / `catchmentCutOff` / `eldsCutOff` are nullable.** Where the dossier has no confirmed figure for a course (marked "—" — e.g. FUTA's Chemical Engineering, several "estimate only" rows), the field is `null`, not a guessed number. **This is a deliberate deviation from the frontend's current `Course` type**, which declares these as non-nullable `number` — the frontend will need to handle `null` (or this dossier gap needs filling first) before wiring up real data end-to-end for the affected courses. `computeAggregate()`/`buildAssessmentContext()` throw a clear 400 (not a silent 0-comparison) when a candidate's resolved cut-off is `null`; `recommendCourses()` just skips those courses.
- **Scale consistency**: `computeAggregate()` always produces a 0–100 aggregate, so cut-offs must be on that same scale to compare sensibly.
  - UI, UNILAG, OAU: dossier gives a native 0–100 aggregate — used as-is.
  - FUTA, FUOYE: dossier gives both a 0–100 aggregate and a separate raw-JAMB "estimated" figure — only the 0–100 aggregate is stored.
  - **FUNAAB is a known, unresolved exception**: the dossier's only published cut-off is the raw 0–400 JAMB floor (160–200) — no 0–100 aggregate is published anywhere, even though FUNAAB's own Confirmed formula computes one internally. Seeded as published, which means `computeAggregate()` (capped at 100) can never clear a FUNAAB cut-off. Needs a real FUNAAB 0–100 figure — via Stage 5 admin CRUD, or further research — before FUNAAB assessments work correctly. Flagged loudly in the seed script; don't "fix" it by inventing a conversion factor.
- **Excluded, not fabricated**: FUTA and FUNAAB's dossier tables include "Law"/"Arts" rows that just state those faculties don't exist — those two rows per university are not seeded as courses. FUOYE's Law *is* seeded (aggregate cut-off `null`) despite the dossier's open question over whether that faculty exists at all.
- **`Course.catchmentCutOffByState` / `eldsCutOffByState`** (JSON) hold real per-state cut-off overrides for UNILAG (5 sample courses) and OAU (all 35 courses, from OAU's own faculty documents) — see the dossier's UNILAG/OAU sections for why a single flat number per course doesn't match what these universities actually publish. Falls back to `catchmentCutOff`/`eldsCutOff` when a state isn't present in the map.
- **`AdmissionRequirement` uses one template per faculty** (`REQUIREMENT_TEMPLATES` in the seed script), not a hand-crafted subject list per course — the dossier documents a general per-stream O'Level/UTME rule rather than an exact combination for most of the 210 courses, so applying it uniformly is the honest choice. The one exception: FUOYE has its own detailed per-course admission-requirements document (see the dossier's FUOYE section) that's more granular than this template approach — worth revisiting once that's transcribed.

## Data model notes

- `AssessmentReport` stores `VerificationResult` / `AggregateScoreResult` / `CatchmentResult` / `CourseRecommendation[]` / `AssessmentContext` as JSON rather than five more tables — those shapes are read-mostly, per-candidate, and never queried by their internal fields.

## What's not done yet

- **Stage 5 onward** — admin CRUD, metrics/evaluation dashboard, hardening (rate limiting, structured logging, load testing). See the frontend repo's `docs/backend-implementation-plan.md`.
- **The FUNAAB scale mismatch** (see "Seed data" above) — the single biggest blocker to FUNAAB actually working end-to-end.
- **OAU's Law/Accounting split, FUOYE's Law faculty (open question), UI's real catchment/ELDS state names, FUTA's "Social & Management Sciences" faculty (open question)** — all flagged in the dossier as unresolved; don't treat the seed script's placeholders for these as settled.
- **Frontend `Course` type still declares cut-offs as non-nullable** — needs updating to `number | null` (or the dossier gaps need filling) before every course in the catalog can round-trip cleanly through the existing frontend UI.

## Folder layout

```
prisma/
  schema.prisma       Data model — mirrors domain.ts in the frontend repo
  seed.ts             Seed script (6 universities + starter course subset)
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
    # admin/, evaluation/ (Stage 5/6) — added stage by stage
  types/
    express.d.ts        augments Express's Request with `user?: AuthUser`
```

## Roadmap

See the frontend repo's `docs/backend-implementation-plan.md` for the full 8-stage plan and `docs/jamb-data-dossier.md` for the seed-data specification (per-university cut-offs, scoring formulas, catchment/ELDS data). Next up: **Stage 5 — admin CRUD** (`GET/POST/PATCH/DELETE` for universities, courses, requirements, scoring policies, catchment rules, all behind `requireAdmin`, each mutation writing an `AdminLogEntry`).
