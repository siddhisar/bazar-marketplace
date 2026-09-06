/**
 * `notFound` and `errorHandler` are mounted last in app.ts, after every real
 * route. Express tries routes top to bottom; if none matched, `notFound`
 * runs. `errorHandler` is different — Express recognises it as an *error*
 * handler specifically because it takes four parameters (`err` first); a
 * controller reaches it by calling `next(err)` instead of `next()`, and
 * Express skips straight past any normal middleware to get here.
 */
import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response";
import { config } from "../config/env";

/** 404 handler for unmatched routes. */
export function notFound(req: Request, res: Response): void {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

/**
 * Central error handler — keeps controllers free of response boilerplate.
 *
 * The real message is always logged server-side. It only reaches the client
 * outside production: in production an unexpected error's message might be a
 * raw driver/constraint detail (a column name, a query fragment) that is not
 * this caller's business, so a generic message goes out instead.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  console.error("[error]", err);

  const message =
    !config.isProduction && err instanceof Error
      ? err.message
      : "Something went wrong. Please try again.";
  sendError(res, 500, message);
}
