import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
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

  // Stage 3+ routers get mounted here as they're built:
  // app.use(catalogRouter);      // GET /universities, /courses/:id/requirements, ...
  // app.use(assessmentRouter);   // POST /eligibility/verify, /scoring/aggregate, /assessments, ...
  // app.use(adminRouter);        // /admin/*
  // ...

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
