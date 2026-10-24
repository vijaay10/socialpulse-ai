import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { AppContext } from "../../src/app.js";
import { ADMIN, setupTestApp, teardown } from "../helpers.js";

let app: Express;
let ctx: AppContext;

// Point the cache at a port where nothing listens to simulate a Redis outage.
beforeAll(async () => {
  ({ app, ctx } = await setupTestApp({ redisUrl: "redis://127.0.0.1:6399" }));
});
afterAll(async () => teardown(ctx));

describe("Redis unavailable", () => {
  it("keeps serving MongoDB-backed functionality with X-Cache: BYPASS", async () => {
    expect(ctx.cache.isReady).toBe(false);
    const seed = await request(app).post("/api/ingestion/seed").set(ADMIN).send({ count: 100, seed: 5 }).expect(201);
    expect(seed.body.data.imported).toBe(100);
    expect(seed.body.data.cache.invalidatedKeys).toBe(0);

    for (const path of ["/api/analytics/overview", "/api/analytics/trends", "/api/analytics/trends/rising", "/api/analytics/sentiment", "/api/analytics/engagement", "/api/posts"]) {
      const res = await request(app).get(path).expect(200);
      expect(res.headers["x-cache"]).toBe("BYPASS");
      expect(res.body.meta.cache.reason).toBe("redis_unavailable");
    }
    const overview = await request(app).get("/api/analytics/overview?window=all").expect(200);
    expect(overview.body.data.totals.posts).toBe(100);
  });

  it("reports degraded health and Redis down in cache stats", async () => {
    const health = await request(app).get("/api/health").expect(200);
    expect(health.body.status).toBe("degraded");
    expect(health.body.services.redis.status).toBe("down");
    const stats = await request(app).get("/api/cache/stats").expect(200);
    expect(stats.body.data.redis.status).toBe("down");
    expect(stats.body.data.local.bypasses).toBeGreaterThan(0);
  });
});
