import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { AppContext } from "../../src/app.js";
import { ADMIN, setupTestApp, teardown } from "../helpers.js";

let app: Express;
let ctx: AppContext;

// Redis on its own: after MongoDB disconnects, only results already in the cache can be served.
beforeAll(async () => {
  ({ app, ctx } = await setupTestApp());
  await request(app).post("/api/ingestion/seed").set(ADMIN).send({ count: 150, seed: 9 }).expect(201);
  await request(app).get("/api/analytics/overview?window=7d").expect(200); // prime the cache
  await mongoose.disconnect();
});
afterAll(async () => {
  await mongoose.connect(ctx.config.MONGODB_URI);
  await teardown(ctx);
});

describe("MongoDB unavailable, Redis up", () => {
  it("still serves analytics that are cached in Redis", async () => {
    const res = await request(app).get("/api/analytics/overview?window=7d").expect(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.body.data.totals.posts).toBeGreaterThan(0);
  });

  it("fails fast with 503 for requests that are not cached", async () => {
    const t0 = Date.now();
    const res = await request(app).get("/api/analytics/trends?window=24h").expect(503);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.body.error).toBe("ServiceUnavailable");
    expect(res.body.message).toMatch(/MongoDB is unavailable/);
  });

  it("rejects ingestion and reports MongoDB down in health", async () => {
    await request(app).post("/api/ingestion/seed").set(ADMIN).send({ count: 10 }).expect(503);
    const health = await request(app).get("/api/health").expect(503);
    expect(health.body.services.mongodb.status).toBe("down");
    expect(health.body.services.redis.status).toBe("up");
  });
});
