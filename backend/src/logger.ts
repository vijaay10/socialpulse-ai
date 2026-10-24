import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "socialpulse-backend" },
  redact: ["req.headers['x-api-key']", "req.headers.authorization"],
});
