import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

/** Administrative endpoints require the X-API-Key header to match ADMIN_API_KEY. */
export function requireAdmin(adminKey: string): RequestHandler {
  const expected = Buffer.from(adminKey);
  return (req, _res, next) => {
    const provided = Buffer.from(String(req.header("x-api-key") ?? ""));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return next(new HttpError(401, "Missing or invalid X-API-Key header"));
    }
    next();
  };
}
