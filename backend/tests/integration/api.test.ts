import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { AppContext } from "../../src/app.js";
import { Comment, EngagementMetric, Hashtag, IngestionBatch, Post, SentimentResult, Trend, User } from "../../src/models/index.js";
import { ADMIN, setupTestApp, teardown } from "../helpers.js";

let app: Express;
let ctx: AppContext;

beforeAll(async () => {
  ({ app, ctx } = await setupTestApp());
});
afterAll(async () => teardown(ctx));

describe("health", () => {
  it("reports MongoDB, Redis and NLP up", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.services.mongodb.status).toBe("up");
    expect(res.body.services.redis.status).toBe("up");
    expect(res.body.services.nlp.status).toBe("up");
  });
});

describe("ingestion and persistence", () => {
  it("rejects admin endpoints without the API key", async () => {
    await request(app).post("/api/ingestion/seed").send({ count: 10 }).expect(401);
    await request(app).post("/api/ingestion/seed").set("x-api-key", "wrong").send({ count: 10 }).expect(401);
    await request(app).post("/api/cache/invalidate").send({}).expect(401);
  });

  it("seeds synthetic data and persists posts, sentiment and related collections", async () => {
    const res = await request(app).post("/api/ingestion/seed").set(ADMIN).send({ count: 600, seed: 11 }).expect(201);
    const r = res.body.data;
    expect(r).toMatchObject({ received: 600, processed: 600, imported: 600, skipped: 0, failed: 0, synthetic: true });
    expect(r.sentiment.positive + r.sentiment.neutral + r.sentiment.negative).toBe(600);

    expect(await Post.countDocuments()).toBe(600);
    expect(await Post.countDocuments({ "source.synthetic": true })).toBe(600);
    expect(await SentimentResult.countDocuments({ target_type: "post" })).toBe(600);
    expect(await User.countDocuments()).toBeGreaterThan(0);
    expect(await Hashtag.countDocuments()).toBeGreaterThan(10);
    expect(await Comment.countDocuments()).toBe(r.commentsImported);
    expect(await EngagementMetric.countDocuments()).toBeGreaterThanOrEqual(600);
    expect(await Trend.countDocuments()).toBe(r.trendsMaterialized);
    expect(await IngestionBatch.countDocuments({ batch_id: r.batchId })).toBe(1);

    const post = await Post.findOne().lean();
    expect(post?.sentiment.model).toBe("vader");
    expect(["positive", "neutral", "negative"]).toContain(post?.sentiment.label);
    expect(post?.schema_version).toBe(2);
    expect(post?.user_ref).toBeDefined();
  });

  it("skips duplicates when the same data is ingested again", async () => {
    const res = await request(app).post("/api/ingestion/seed").set(ADMIN).send({ count: 600, seed: 11 }).expect(200);
    expect(res.body.data).toMatchObject({ imported: 0, skipped: 600, failed: 0 });
    expect(await Post.countDocuments()).toBe(600);
  });

  it("reports failed records in an invalid upload without importing them", async () => {
    const records = [
      { post_id: "inv_ok", platform: "twitter", text: "This upload works great #testing", created_at: "2026-10-01T10:00:00Z", user_id: "u1", likes: 3, reach: 100 },
      { post_id: "inv_ok", platform: "twitter", text: "duplicate in batch", created_at: "2026-10-01T10:00:00Z", user_id: "u1" },
      { post_id: "inv_bad_platform", platform: "orkut", text: "x", created_at: "2026-10-01T10:00:00Z", user_id: "u1" },
      { post_id: "inv_bad_date", platform: "twitter", text: "x", created_at: "nope", user_id: "u1" },
      42,
    ];
    const res = await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from(JSON.stringify(records)), "bad.json").expect(201);
    expect(res.body.data).toMatchObject({ received: 5, processed: 2, imported: 1, skipped: 1, failed: 3 });
    expect(res.body.data.errors.map((e: { index: number }) => e.index)).toEqual([2, 3, 4]);
    expect(await Post.countDocuments({ post_id: { $in: ["inv_bad_platform", "inv_bad_date"] } })).toBe(0);
  });

  it("imports CSV uploads", async () => {
    const csv = "post_id,platform,text,hashtags,created_at,user_id,likes,shares,comments,reach\ncsv_1,instagram,\"Amazing biryani, loved it\",biryani foodie,2026-10-02T10:00:00Z,u9,50,5,5,1000\n";
    const res = await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from(csv), "posts.csv").expect(201);
    expect(res.body.data.imported).toBe(1);
    const p = await Post.findOne({ post_id: "csv_1" }).lean();
    expect(p?.hashtags).toEqual(["biryani", "foodie"]);
    expect(p?.engagement_rate).toBe(6);
    expect(p?.sentiment.label).toBe("positive");
    // Optional fields are omitted, not stored as null (text-only post has no media).
    expect(p && "media" in p).toBe(false);
  });

  it("rejects unsupported, empty and malformed files safely", async () => {
    await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from("hello"), "notes.txt").expect(415);
    await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from("   "), "empty.json").expect(400);
    const bad = await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from("{oops"), "x.json").expect(400);
    expect(bad.body.message).toMatch(/Invalid JSON/);
    await request(app).post("/api/ingestion/upload").set(ADMIN).expect(400);
  });
});

describe("analytics correctness", () => {
  it("overview totals match the database", async () => {
    const res = await request(app).get("/api/analytics/overview?window=all").expect(200);
    const all = await Post.find({}, { engagement: 1, interactions: 1, sentiment: 1, platform: 1 }).lean();
    const t = res.body.data.totals;
    expect(t.posts).toBe(all.length);
    expect(t.likes).toBe(all.reduce((s, p) => s + p.engagement.likes, 0));
    expect(t.interactions).toBe(all.reduce((s, p) => s + p.interactions, 0));
    const neg = all.filter((p) => p.sentiment.label === "negative").length;
    expect(res.body.data.sentiment.distribution.negative).toBe(neg);
    const twitter = res.body.data.platforms.find((p: { platform: string }) => p.platform === "twitter");
    expect(twitter.posts).toBe(all.filter((p) => p.platform === "twitter").length);
  });

  it("top hashtag counts match the database for a time window", async () => {
    const res = await request(app).get("/api/analytics/trends?window=7d&limit=5").expect(200);
    const { from, to } = res.body.data.range;
    const top = res.body.data.items[0];
    const expected = await Post.countDocuments({ hashtags: top.key, created_at: { $gte: new Date(from), $lte: new Date(to) } });
    expect(top.count).toBe(expected);
    const prev = res.body.data.previousRange;
    expect(top.previousCount).toBe(await Post.countDocuments({ hashtags: top.key, created_at: { $gte: new Date(prev.from), $lt: new Date(prev.to) } }));
    expect(res.body.data.items.map((i: { count: number }) => i.count)).toEqual([...res.body.data.items.map((i: { count: number }) => i.count)].sort((a, b) => b - a));
  });

  it("rising trends compare the current window with the previous one", async () => {
    const res = await request(app).get("/api/analytics/trends/rising?window=7d&minCount=2").expect(200);
    for (const item of res.body.data.rising) expect(item.count).toBeGreaterThan(item.previousCount);
    for (const item of res.body.data.falling) expect(item.count).toBeLessThan(item.previousCount);
  });

  it("filters change the result and are applied correctly", async () => {
    const all = await request(app).get("/api/analytics/sentiment?window=all").expect(200);
    const tw = await request(app).get("/api/analytics/sentiment?window=all&platform=twitter").expect(200);
    const pos = await request(app).get("/api/analytics/engagement?window=all&sentiment=positive").expect(200);
    expect(tw.body.meta.cache.key).not.toBe(all.body.meta.cache.key);
    expect(tw.body.data.overall.total).toBe(await Post.countDocuments({ platform: "twitter" }));
    expect(tw.body.data.byPlatform.map((p: { platform: string }) => p.platform)).toEqual(["twitter"]);
    expect(pos.body.data.totals.posts).toBe(await Post.countDocuments({ "sentiment.label": "positive" }));
    const tag = await request(app).get("/api/analytics/overview?window=all&hashtag=%23AI").expect(200);
    expect(tag.body.data.totals.posts).toBe(await Post.countDocuments({ hashtags: "ai" }));
  });

  it("engagement rate and correlation are computed from records", async () => {
    const res = await request(app).get("/api/analytics/engagement?window=all").expect(200);
    const d = res.body.data;
    expect(d.formula).toMatch(/likes \+ shares \+ comments/);
    expect(d.totals.aggregateEngagementRate).toBeCloseTo((d.totals.interactions / d.totals.reach) * 100, 3);
    const r = d.correlations.followersVsInteractions.r;
    expect(r).toBeGreaterThan(-1);
    expect(r).toBeLessThan(1);
    expect(d.topPosts[0].interactions).toBeGreaterThanOrEqual(d.topPosts[1].interactions);
  });

  it("validates query parameters", async () => {
    const res = await request(app).get("/api/analytics/overview?platform=myspace").expect(400);
    expect(res.body.error).toBe("ValidationError");
    await request(app).get("/api/analytics/trends?limit=999").expect(400);
    await request(app).get("/api/analytics/overview?from=2026-10-10&to=2026-10-01").expect(400);
    await request(app).get("/api/analytics/overview?from=garbage").expect(400);
    await request(app).get("/api/nope").expect(404);
  });
});

describe("posts", () => {
  it("paginates, filters and searches", async () => {
    const p1 = await request(app).get("/api/posts?limit=5&page=1&platform=instagram").expect(200);
    const p2 = await request(app).get("/api/posts?limit=5&page=2&platform=instagram").expect(200);
    expect(p1.body.data.items).toHaveLength(5);
    expect(p1.body.data.pagination.total).toBe(await Post.countDocuments({ platform: "instagram" }));
    const ids1 = p1.body.data.items.map((p: { _id: string }) => p._id);
    expect(p2.body.data.items.some((p: { _id: string }) => ids1.includes(p._id))).toBe(false);
    const search = await request(app).get("/api/posts?q=biryani").expect(200);
    expect(search.body.data.items.length).toBeGreaterThan(0);
    for (const p of search.body.data.items) expect(`${p.text} ${p.hashtags.join(" ")}`.toLowerCase()).toContain("biryani");
  });

  it("returns post details with related documents, and 404 for unknown ids", async () => {
    const post = await Post.findOne({ "source.kind": "seed" }).lean();
    const res = await request(app).get(`/api/posts/${post!._id}`).expect(200);
    expect(res.body.data.post.post_id).toBe(post!.post_id);
    expect(res.body.data.sentimentHistory).toHaveLength(1);
    expect(res.body.data.engagementHistory.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.author.user_id).toBe(post!.user.user_id);
    await request(app).get(`/api/posts/${post!.post_id}`).expect(200);
    await request(app).get("/api/posts/does_not_exist").expect(404);
  });
});

describe("Redis cache-aside behaviour", () => {
  it("first request is a miss, identical second request is a hit with identical data", async () => {
    await ctx.cache.invalidate([], "test");
    const first = await request(app).get("/api/analytics/overview?window=30d&platform=twitter,instagram").expect(200);
    const second = await request(app).get("/api/analytics/overview?platform=instagram,twitter&window=30d").expect(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.meta.cache.key).toBe(first.body.meta.cache.key);
  });

  it("uses the configured TTL per namespace", async () => {
    const res = await request(app).get("/api/analytics/sentiment?window=7d").expect(200);
    expect(res.body.meta.cache.ttlSeconds).toBe(120);
    const client = (ctx.cache as unknown as { client: { ttl: (k: string) => Promise<number> } }).client;
    const ttl = await client.ttl(res.body.meta.cache.key);
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);
    const trends = await request(app).get("/api/analytics/trends?window=7d").expect(200);
    expect(trends.body.meta.cache.ttlSeconds).toBe(60);
  });

  it("ingestion invalidates cached analytics and new records show up", async () => {
    const before = await request(app).get("/api/analytics/overview?window=all").expect(200);
    const cached = await request(app).get("/api/analytics/overview?window=all").expect(200);
    expect(cached.headers["x-cache"]).toBe("HIT");

    const newPost = { post_id: "fresh_1", platform: "linkedin", text: "Thrilled to join the team #newjob", created_at: new Date(Date.now() - 3600_000).toISOString(), user_id: "u_new", likes: 10, reach: 100 };
    const up = await request(app).post("/api/ingestion/upload").set(ADMIN).attach("file", Buffer.from(JSON.stringify([newPost])), "one.json").expect(201);
    expect(up.body.data.cache.invalidatedKeys).toBeGreaterThan(0);

    const after = await request(app).get("/api/analytics/overview?window=all").expect(200);
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.data.totals.posts).toBe(before.body.data.totals.posts + 1);
  });

  it("reports hit/miss statistics", async () => {
    const res = await request(app).get("/api/cache/stats").expect(200);
    const s = res.body.data;
    expect(s.redis.status).toBe("up");
    expect(s.totals.hits).toBeGreaterThan(0);
    expect(s.totals.misses).toBeGreaterThan(0);
    expect(s.totals.hitRatio).toBeCloseTo(s.totals.hits / (s.totals.hits + s.totals.misses), 3);
    expect(s.namespaces.find((n: { namespace: string }) => n.namespace === "analytics:overview")).toBeDefined();
    expect(s.invalidations.length).toBeGreaterThan(0);
    expect(s.ttlSeconds.overview).toBe(60);
  });

  it("manual invalidation by namespace only removes that namespace", async () => {
    await request(app).get("/api/analytics/overview?window=7d").expect(200);
    await request(app).get("/api/analytics/engagement?window=7d").expect(200);
    const inv = await request(app).post("/api/cache/invalidate").set(ADMIN).send({ namespaces: ["analytics:overview"] }).expect(200);
    expect(inv.body.data.deleted).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/analytics/overview?window=7d")).headers["x-cache"]).toBe("MISS");
    expect((await request(app).get("/api/analytics/engagement?window=7d")).headers["x-cache"]).toBe("HIT");
  });
});

describe("benchmark endpoint", () => {
  it("runs a small benchmark and stores the result", async () => {
    const res = await request(app).post("/api/benchmark/run").set(ADMIN).send({ iterations: 5, warmup: 1, workloadRequests: 20 }).expect(201);
    const q = res.body.data.results.datasets[0].queries;
    expect(q.length).toBeGreaterThan(3);
    for (const item of q) {
      expect(item.hitRatio).toBe(1);
      expect(item.mongo.runs).toBe(5);
    }
    const list = await request(app).get("/api/benchmark/results").expect(200);
    expect(list.body.data[0].run_id).toBe(res.body.data.run_id);
  });
});
