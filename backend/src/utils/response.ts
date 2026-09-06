/**
 * Every API response goes through one of these two functions, so the
 * frontend can always check `response.success` first and know where to find
 * either the data or the error message — see `frontend/src/lib/api.ts`,
 * which unwraps exactly this shape for every request it makes.
 */
import type { Response } from "express";

/** Uniform success envelope: { success: true, data }. */
export function sendSuccess<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

/** Uniform error envelope: { success: false, message }. */
export function sendError(res: Response, status: number, message: string): Response {
  return res.status(status).json({ success: false, message });
}
