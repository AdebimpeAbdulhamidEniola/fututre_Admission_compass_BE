import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't catch rejected promises from async handlers, so an unhandled rejection
 * would hang the request instead of reaching errorHandler. Wrap every async route with this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
