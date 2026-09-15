import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    statusCode: 404,
    message: `Cannot ${req.method} ${req.path}`,
    error: "Not Found",
  });
}

type RequestWithLogger = Request & { log?: { error: (obj: unknown, msg?: string) => void } };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 params to recognize this as an error handler.
export function errorHandler(err: unknown, req: RequestWithLogger, res: Response, next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    statusCode: 500,
    message: env.isProduction ? "Internal server error" : (err as Error)?.message || "Internal server error",
    error: "Internal Server Error",
  });
}
