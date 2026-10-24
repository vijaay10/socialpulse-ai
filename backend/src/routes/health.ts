import { Router } from "express";
import mongoose from "mongoose";
import type { AppContext } from "../app.js";
import { mongoHealth } from "../db/mongo.js";
import { Post } from "../models/Post.js";

export function healthRouter(ctx: AppContext) {
  const r = Router();
  r.get("/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  r.get("/", async (_req, res) => {
    const [mongo, redis, nlp] = await Promise.all([mongoHealth(), ctx.cache.health(), ctx.nlp.health()]);
    const posts = mongo.status === "up" ? await Post.estimatedDocumentCount().catch(() => null) : null;
    // MongoDB is required; Redis and NLP are degraded-but-serving when down.
    const status = mongo.status !== "up" ? "down" : redis.status !== "up" || nlp.status !== "up" ? "degraded" : "ok";
    res.status(status === "down" ? 503 : 200).json({
      status,
      uptimeSeconds: Math.round(process.uptime()),
      services: {
        mongodb: { ...mongo, host: mongoose.connection.host, posts },
        redis: { ...redis, keyPrefix: ctx.cache.prefix },
        nlp,
      },
    });
  });
  return r;
}
