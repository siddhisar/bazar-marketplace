import { config } from "../config/env";

/**
 * Normalises a stored image path to the public `/images/...` form the API
 * serves. Paths are stored that way already; this guards the odd row that was
 * written as a bare filename.
 */
export function resolveImagePath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith(`${config.imagesRoute}/`)) return path;
  return `${config.imagesRoute}/${path.replace(/^\/+/, "")}`;
}
