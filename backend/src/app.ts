import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import type { CacheService } from "./cache/cacheService.js";
import type { Config } from "./config.js";
import { openapiSpec } from "./docs/openapi.js";
import { logger } from "./logger.js";
import { errorHandler, notFound, requireMongo } from "./middleware/errors.js";
import type { SentimentAnalyzer } from "./nlp/nlpClient.js";
import { analyticsRouter } from "./routes/analytics.js";
import { benchmarkRouter } from "./routes/benchmark.js";
import { cacheRouter } from "./routes/cache.js";
import { healthRouter } from "./routes/health.js";
import { ingestionRouter } from "./routes/ingestion.js";
import { postsRouter } from "./routes/posts.js";

export interface AppContext {
  config: Config;
  cache: CacheService;
  nlp: SentimentAnalyzer;
}

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("query parser", "extended");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || ctx.config.corsOrigins.includes(origin)),
      exposedHeaders: ["X-Cache", "X-Cache-Key", "X-Response-Time-Ms"],
    }),
  );
  if (ctx.config.NODE_ENV !== "test") app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health/live" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: ctx.config.RATE_LIMIT_PER_MINUTE,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skip: (req) => req.path.startsWith("/health") || ctx.config.NODE_ENV === "test",
      message: { error: "TooManyRequests", message: "Rate limit exceeded" },
    }),
  );

  app.get("/api/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: "SocialPulse AI API" }));
  app.use("/api/health", healthRouter(ctx));
  app.use("/api/analytics", analyticsRouter(ctx));
  app.use("/api/posts", postsRouter(ctx));
  app.use("/api/ingestion", requireMongo, ingestionRouter(ctx));
  app.use("/api/cache", cacheRouter(ctx));
  app.use("/api/benchmark", requireMongo, benchmarkRouter(ctx));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
