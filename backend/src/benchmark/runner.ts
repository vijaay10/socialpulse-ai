import os from "node:os";
import mongoose from "mongoose";
import type { CacheService } from "../cache/cacheService.js";
import { getEngagementAnalytics } from "../analytics/engagement.js";
import type { Filters } from "../analytics/filters.js";
import { getOverview } from "../analytics/overview.js";
import { listPosts } from "../analytics/posts.js";
import { getSentimentAnalytics } from "../analytics/sentiment.js";
import { getRisingTrends, getTrends } from "../analytics/trends.js";
import { Post } from "../models/Post.js";

export interface LatencyStats {
  runs: number;
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export interface QueryBenchmark {
  name: string;
  params: Record<string, unknown>;
  mongo: LatencyStats;
  cacheMiss: LatencyStats;
  cacheHit: LatencyStats;
  hitRatio: number;
  speedupMedian: number | null;
}

export interface BenchmarkOptions {
  warmup: number;
  iterations: number;
  queries?: string[];
}

/** Fixed, representative queries; identical parameters on every run. */
export const BENCH_QUERIES: { name: string; params: Record<string, unknown>; run: () => Promise<unknown> }[] = [
  { name: "overview(30d)", params: { window: "30d" }, run: () => getOverview({ window: "30d" }) },
  { name: "trends:top(7d,hashtag)", params: { window: "7d", kind: "hashtag", limit: 10 }, run: () => getTrends({ window: "7d" }, { kind: "hashtag", limit: 10 }) },
  { name: "trends:rising(7d)", params: { window: "7d", kind: "hashtag", limit: 10, minCount: 3 }, run: () => getRisingTrends({ window: "7d" }, { kind: "hashtag", limit: 10, minCount: 3 }) },
  {
    name: "sentiment(30d,twitter)",
    params: { window: "30d", platform: ["twitter"] },
    run: () => getSentimentAnalytics({ window: "30d", platform: ["twitter"] } as Filters, { hashtagLimit: 10 }),
  },
  { name: "engagement(30d)", params: { window: "30d" }, run: () => getEngagementAnalytics({ window: "30d" }, { topLimit: 10 }) },
  { name: "posts:list(hashtag=ai)", params: { hashtag: ["ai"], page: 1 }, run: () => listPosts({ hashtag: ["ai"] }, { page: 1, limit: 20, sort: "recent" }) },
];

export function summarize(samples: number[]): LatencyStats {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const q = (p: number) => {
    // Linear interpolation between closest ranks.
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { runs: n, avgMs: r(s.reduce((a, b) => a + b, 0) / n), medianMs: r(q(0.5)), p95Ms: r(q(0.95)), minMs: r(s[0]), maxMs: r(s[n - 1]) };
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

/** MongoDB-only latency for each query (no cache involved). */
export async function measureMongo(opts: BenchmarkOptions): Promise<Record<string, LatencyStats>> {
  const out: Record<string, LatencyStats> = {};
  for (const q of selected(opts)) {
    for (let i = 0; i < opts.warmup; i++) await q.run();
    const samples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) samples.push(await time(q.run));
    out[q.name] = summarize(samples);
  }
  return out;
}

/**
 * For each query: warm-up runs (discarded), then measured MongoDB-direct runs,
 * cache-miss runs (key deleted before each run) and cache-hit runs.
 */
export async function runQueryBenchmarks(benchCache: CacheService, opts: BenchmarkOptions): Promise<QueryBenchmark[]> {
  if (!benchCache.isReady) throw new Error("Redis is not connected; cache benchmarks need a live Redis");
  const results: QueryBenchmark[] = [];
  for (const q of selected(opts)) {
    const ns = `bench:${q.name}`;
    for (let i = 0; i < opts.warmup; i++) await q.run();

    const mongoSamples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) mongoSamples.push(await time(q.run));

    const missSamples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
      await benchCache.invalidate([ns], "benchmark");
      const t0 = performance.now();
      const r = await benchCache.getOrSet(ns, q.params, 300, q.run);
      missSamples.push(performance.now() - t0);
      if (r.cache.status !== "miss") throw new Error(`expected miss for ${q.name}, got ${r.cache.status}`);
    }

    await benchCache.getOrSet(ns, q.params, 300, q.run); // ensure cached
    for (let i = 0; i < opts.warmup; i++) await benchCache.getOrSet(ns, q.params, 300, q.run);
    const hitSamples: number[] = [];
    let hits = 0;
    for (let i = 0; i < opts.iterations; i++) {
      const t0 = performance.now();
      const r = await benchCache.getOrSet(ns, q.params, 300, q.run);
      hitSamples.push(performance.now() - t0);
      if (r.cache.status === "hit") hits++;
    }
    await benchCache.invalidate([ns], "benchmark cleanup");

    const mongo = summarize(mongoSamples);
    const cacheHit = summarize(hitSamples);
    results.push({
      name: q.name,
      params: q.params,
      mongo,
      cacheMiss: summarize(missSamples),
      cacheHit,
      hitRatio: Math.round((hits / opts.iterations) * 10000) / 10000,
      speedupMedian: cacheHit.medianMs > 0 ? Math.round((mongo.medianMs / cacheHit.medianMs) * 10) / 10 : null,
    });
  }
  return results;
}

/** Simulated mixed workload: repeated dashboard requests, reports the observed hit ratio. */
export async function runWorkload(benchCache: CacheService, requests: number, seed = 7) {
  let a = seed;
  const rand = () => ((a = (a * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const windows = ["24h", "7d", "30d"];
  let hits = 0;
  let misses = 0;
  const samples: number[] = [];
  await benchCache.invalidate(["bench:workload"], "benchmark");
  for (let i = 0; i < requests; i++) {
    const q = BENCH_QUERIES[Math.floor(rand() * BENCH_QUERIES.length)];
    const window = windows[Math.floor(rand() * windows.length)];
    const t0 = performance.now();
    const r = await benchCache.getOrSet(`bench:workload:${q.name}`, { ...q.params, window }, 300, q.run);
    samples.push(performance.now() - t0);
    if (r.cache.status === "hit") hits++;
    else misses++;
  }
  await benchCache.invalidate(["bench:workload"], "benchmark cleanup");
  return { requests, hits, misses, hitRatio: Math.round((hits / requests) * 10000) / 10000, latency: summarize(samples), note: `${BENCH_QUERIES.length} queries x ${windows.length} windows = ${BENCH_QUERIES.length * windows.length} distinct keys` };
}

export async function explainTrendQuery() {
  const latest = await Post.findOne({}, { created_at: 1 }).sort({ created_at: -1 }).lean();
  const to = latest?.created_at ?? new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const plan = (await Post.find({ hashtags: "ai", created_at: { $gte: from, $lte: to } }).explain("executionStats")) as unknown as {
    queryPlanner: { winningPlan: unknown };
    executionStats: { nReturned: number; totalKeysExamined: number; totalDocsExamined: number; executionTimeMillis: number };
  };
  const stages: string[] = [];
  const walk = (p: unknown) => {
    if (!p || typeof p !== "object") return;
    const node = p as Record<string, unknown>;
    if (typeof node.stage === "string") stages.push(node.indexName ? `${node.stage}(${node.indexName})` : node.stage);
    walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
    walk(node.queryPlan);
  };
  walk(plan.queryPlanner.winningPlan);
  const s = plan.executionStats;
  return { query: "posts.find({ hashtags: 'ai', created_at: last 7 days })", stages, nReturned: s.nReturned, totalKeysExamined: s.totalKeysExamined, totalDocsExamined: s.totalDocsExamined, executionTimeMillis: s.executionTimeMillis };
}

export async function environment(opts: BenchmarkOptions) {
  const admin = mongoose.connection.db?.admin();
  const info = admin ? await admin.serverInfo().catch(() => null) : null;
  return {
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    mongodbVersion: info?.version,
    mongoHost: mongoose.connection.host,
    posts: await Post.estimatedDocumentCount(),
    warmupRuns: opts.warmup,
    measuredRuns: opts.iterations,
    timing: "in-process wall clock (performance.now) around the service call; excludes HTTP overhead",
  };
}

function selected(opts: BenchmarkOptions) {
  return opts.queries?.length ? BENCH_QUERIES.filter((q) => opts.queries!.includes(q.name)) : BENCH_QUERIES;
}
