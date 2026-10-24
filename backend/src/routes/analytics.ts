import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { withMongo } from "../db/mongo.js";
import { getEngagementAnalytics } from "../analytics/engagement.js";
import { filterSchema, intervalSchema, limitSchema } from "../analytics/filters.js";
import { getOverview } from "../analytics/overview.js";
import { getSentimentAnalytics } from "../analytics/sentiment.js";
import { getMaterializedTrends, getRisingTrends, getTrends } from "../analytics/trends.js";
import { PLATFORMS } from "../models/constants.js";
import { sendCached } from "./cached.js";

const kindSchema = z.enum(["hashtag", "topic"]).default("hashtag");

export function analyticsRouter(ctx: AppContext) {
  const r = Router();
  const { cache, config } = ctx;

  r.get("/overview", async (req, res) => {
    const f = filterSchema.parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:overview", f, config.cacheTtl.overview, withMongo(() => getOverview(f))));
  });

  r.get("/trends", async (req, res) => {
    const f = filterSchema.parse(req.query);
    const opts = z.object({ kind: kindSchema, limit: limitSchema(10, 50), interval: intervalSchema }).parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:trends:top", { ...f, ...opts }, config.cacheTtl.trends, withMongo(() => getTrends(f, opts))));
  });

  r.get("/trends/rising", async (req, res) => {
    const f = filterSchema.parse(req.query);
    const opts = z.object({ kind: kindSchema, limit: limitSchema(10, 50), minCount: z.coerce.number().int().min(1).max(1000).default(3) }).parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:trends:rising", { ...f, ...opts }, config.cacheTtl.trends, withMongo(() => getRisingTrends(f, opts))));
  });

  r.get("/trends/materialized", async (req, res) => {
    const opts = z
      .object({ kind: kindSchema, window: z.enum(["24h", "7d", "30d", "90d"]).default("7d"), platform: z.enum(["all", ...PLATFORMS]).default("all") })
      .parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:trends:materialized", opts, config.cacheTtl.trends, withMongo(() => getMaterializedTrends(opts))));
  });

  r.get("/sentiment", async (req, res) => {
    const f = filterSchema.parse(req.query);
    const opts = z.object({ interval: intervalSchema, hashtagLimit: limitSchema(10, 50) }).parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:sentiment", { ...f, ...opts }, config.cacheTtl.sentiment, withMongo(() => getSentimentAnalytics(f, opts))));
  });

  r.get("/engagement", async (req, res) => {
    const f = filterSchema.parse(req.query);
    const opts = z.object({ interval: intervalSchema, topLimit: limitSchema(10, 50) }).parse(req.query);
    sendCached(res, await cache.getOrSet("analytics:engagement", { ...f, ...opts }, config.cacheTtl.engagement, withMongo(() => getEngagementAnalytics(f, opts))));
  });

  return r;
}
