import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { assertMongoReady, isMongoConnectionError, MONGO_UNAVAILABLE } from "../db/mongo.js";
import { logger } from "../logger.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const requireMongo: RequestHandler = (_req, _res, next) => {
  try {
    assertMongoReady();
    next();
  } catch (err) {
    next(err);
  }
};

export const notFound: RequestHandler = (req, _res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "ValidationError", message: "Invalid request parameters", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof MulterError) {
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "UploadError", message: err.message });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "BadRequest", message: "Malformed JSON body" });
    return;
  }
  if (isMongoConnectionError(err)) {
    logger.warn({ path: req.path, err: err.message }, "MongoDB unavailable");
    res.status(503).json({ error: "DatabaseUnavailable", message: MONGO_UNAVAILABLE });
    return;
  }
  if (err instanceof HttpError && err.status === 503) {
    res.status(503).json({ error: "ServiceUnavailable", message: err.message });
    return;
  }
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) logger.error({ err, path: req.path }, "Unhandled error");
  res.status(status).json({
    error: status >= 500 ? "InternalServerError" : err.name === "Error" ? "RequestError" : err.name,
    message: status >= 500 ? "An unexpected error occurred" : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
};
