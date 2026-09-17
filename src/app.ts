import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import { candidatesRouter } from "./modules/candidates/candidates.routes.js";
import { catchmentRouter } from "./modules/assessment/catchment.routes.js";
import { eligibilityRouter } from "./modules/assessment/eligibility.routes.js";
import { recommendationsRouter } from "./modules/assessment/recommendations.routes.js";
import { scoringRouter } from "./modules/assessment/scoring.routes.js";
import { assessmentsRouter } from "./modules/assessments/assessments.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(
    pinoHttp({
      level: env.isProduction ? "info" : "debug",
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );

  app.use(healthRouter);
  app.use(authRouter);
  app.use(catalogRouter);
  app.use(candidatesRouter);
  app.use(eligibilityRouter);
  app.use(scoringRouter);
  app.use(catchmentRouter);
  app.use(recommendationsRouter);
  app.use(assessmentsRouter);

  // Stage 5+ routers get mounted here as they're built:
  // app.use(adminRouter);        // /admin/*
  // ...

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
