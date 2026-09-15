# PlaceRight Backend

Express.js backend for [PlaceRight](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass) — a decision-support system for university admission placement in Nigeria. This repo implements the contract already defined by the frontend (`src/types/domain.ts`, `src/lib/http.ts`, and the endpoint list in that repo's README).

Being built stage by stage per [`docs/backend-implementation-plan.md`](https://github.com/AdebimpeAbdulhamidEniola/future-admissions-compass/blob/main/docs/backend-implementation-plan.md) in the frontend repo. **Stage 0 (this commit): project scaffold** — an Express app that boots, has the error envelope wired, and passes a health check.

## Getting started

```sh
npm install
cp .env.example .env
npm run dev
```

```sh
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}

curl http://localhost:3000/nonexistent
# {"statusCode":404,"message":"Cannot GET /nonexistent","error":"Not Found"}
```

## Scripts

- `npm run dev` — start with hot reload (tsx watch)
- `npm run build` — compile to `dist/`
- `npm start` — run the compiled build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` / `npm run format`

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

Async handlers: Express 4 doesn't auto-catch rejected promises, so wrap async route handlers or throw synchronously before the first `await` until Stage 7 adds a wrapper — this scaffold doesn't have any async routes yet.

## Folder layout

```
src/
  app.ts              Express app wiring (middleware, routers, error handler)
  server.ts           entrypoint — starts the HTTP listener
  config/
    env.ts            env loading + validation
  lib/
    errors.ts         ApiError + helpers (notFound, badRequest, ...)
  middleware/
    error-handler.ts  global error handler + 404 handler
  modules/
    health/           GET /health
    # auth/, candidates/, catalog/, eligibility/, scoring/, catchment/,
    # recommendations/, assessments/, admin/, evaluation/ — added stage by stage
```

## Roadmap

See the frontend repo's `docs/backend-implementation-plan.md` for the full 8-stage plan and `docs/jamb-data-dossier.md` for the seed-data specification (per-university cut-offs, scoring formulas, catchment/ELDS data). Next up: **Stage 1 — data layer** (Postgres + an ORM, schema for `University`/`Course`/`AdmissionRequirement`/`ScoringPolicy`/`CatchmentRule`, seed script from the dossier).
