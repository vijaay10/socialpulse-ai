/**
 * Reproducible MongoDB vs Redis benchmark.
 * Usage: npm run benchmark -- --sizes 1000,5000,20000 --iterations 30 --warmup 5 --workload 300
 *
 * Runs against a separate database (<db>_bench) so the main dataset is untouched.
 * For each dataset size: seed synthetic data (seed 42) through the normal ingestion
 * pipeline, measure MongoDB-direct, cache-miss and cache-hit latency with all
 * indexes, then drop the secondary indexes on `posts` and measure MongoDB again.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { environment, explainTrendQuery, measureMongo, runQueryBenchmarks, runWorkload } from "../benchmark/runner.js";
import { connectMongo, disconnectMongo } from "../db/mongo.js";
import { ingestRecords } from "../ingestion/pipeline.js";
import { generateSyntheticPosts } from "../ingestion/synthetic.js";
import { allModels, BenchmarkRun, Post, syncIndexes } from "../models/index.js";
import { arg, bootstrap, withDatabase } from "./cli.js";

const sizes = arg("sizes", "1000,5000,20000").split(",").map(Number);
const opts = { iterations: Number(arg("iterations", "30")), warmup: Number(arg("warmup", "5")) };
const workloadRequests = Number(arg("workload", "300"));

const mainUri = (await import("../config.js")).loadConfig().MONGODB_URI;
const benchDb = `${new URL(mainUri).pathname.replace("/", "") || "socialpulse"}_bench`;
const ctx = await bootstrap({ uri: withDatabase(mainUri, benchDb), cachePrefix: "sp:benchcli" });
const benchCache = ctx.cache;
const datasets = [];
let conditions: Awaited<ReturnType<typeof environment>> | null = null;

for (const size of sizes) {
  console.log(`\n=== Dataset: ${size} posts ===`);
  for (const m of allModels) await (m as typeof Post).deleteMany({});
  await syncIndexes();
  await benchCache.invalidate([], "benchmark reset");
  const t0 = Date.now();
  const report = await ingestRecords(generateSyntheticPosts({ count: size, seed: 42 }), { kind: "seed", synthetic: true, format: "synthetic" }, ctx);
  const ingestMs = Date.now() - t0;
  console.log(`ingested ${report.imported} posts in ${ingestMs} ms`);
  conditions = await environment(opts);

  const queries = await runQueryBenchmarks(benchCache, opts);
  const explainIndexed = await explainTrendQuery();
  for (const q of queries) console.log(`${q.name.padEnd(26)} mongo p50 ${q.mongo.medianMs}ms  miss p50 ${q.cacheMiss.medianMs}ms  hit p50 ${q.cacheHit.medianMs}ms  x${q.speedupMedian}`);

  // Index effect: drop secondary indexes on posts, measure MongoDB, restore.
  const keep = new Set(["_id_", "uniq_platform_post", "created_at_desc"]);
  const indexes = await Post.collection.indexes();
  for (const idx of indexes) if (idx.name && !keep.has(idx.name)) await Post.collection.dropIndex(idx.name);
  const mongoNoIndex = await measureMongo(opts);
  // Without even the created_at index, the time-window filter becomes a collection scan.
  await Post.collection.dropIndex("created_at_desc");
  const mongoNoIndexAtAll = await measureMongo(opts);
  const explainUnindexed = await explainTrendQuery();
  await syncIndexes();
  for (const q of queries) console.log(`${q.name.padEnd(26)} no secondary idx p50 ${mongoNoIndex[q.name].medianMs}ms  no idx p50 ${mongoNoIndexAtAll[q.name].medianMs}ms`);

  datasets.push({
    posts: size,
    ingest: { imported: report.imported, durationMs: ingestMs },
    queries,
    indexEffect: queries.map((q) => ({
      name: q.name,
      allIndexesMedianMs: q.mongo.medianMs,
      onlyCreatedAtIndexMedianMs: mongoNoIndex[q.name].medianMs,
      noSecondaryIndexesMedianMs: mongoNoIndexAtAll[q.name].medianMs,
      allIndexes: q.mongo,
      onlyCreatedAtIndex: mongoNoIndex[q.name],
      noSecondaryIndexes: mongoNoIndexAtAll[q.name],
    })),
    explain: { indexed: explainIndexed, unindexed: explainUnindexed },
    workload: size === sizes[sizes.length - 1] && workloadRequests ? await runWorkload(benchCache, workloadRequests) : null,
  });
}

for (const m of allModels) await (m as typeof Post).deleteMany({});
await benchCache.invalidate([], "benchmark done");
await benchCache.close();
await disconnectMongo();

const runId = `cli_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}_${randomUUID().slice(0, 6)}`;
const result = { run_id: runId, source: "cli", created_at: new Date().toISOString(), conditions: { ...conditions, sizes, benchDatabase: benchDb, dataset: "synthetic, seed 42, 30 days" }, results: { datasets } };

const outDir = path.resolve(process.cwd(), "../docs/benchmarks");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(result, null, 2));
writeFileSync(path.join(outDir, "REPORT.md"), renderMarkdown(result));
console.log(`\nSaved ${path.join(outDir, "latest.json")} and REPORT.md`);

// Store in the main database so the dashboard can display it.
await connectMongo(mainUri);
await BenchmarkRun.create({ ...result, created_at: new Date(result.created_at) });
await mongoose.disconnect();

function renderMarkdown(r: typeof result): string {
  const c = r.conditions as Record<string, unknown>;
  const out: string[] = [
    "# SocialPulse AI: MongoDB vs Redis benchmark",
    "",
    `Run \`${r.run_id}\` at ${r.created_at}. Generated by \`npm run benchmark\`; these are measured values, not estimates.`,
    "",
    "## Conditions",
    "",
    `- Machine: ${c.cpu} (${c.cpus} cores), ${c.memoryGb} GB RAM, ${c.platform}`,
    `- Node ${c.node}, MongoDB ${c.mongodbVersion}, Redis on the same host (Docker)`,
    `- Dataset: ${c.dataset}; separate database \`${c.benchDatabase}\``,
    `- ${c.warmupRuns} warm-up runs (discarded) then ${c.measuredRuns} measured runs per query and mode`,
    `- Timing: ${c.timing}`,
    "- **mongo** = aggregation executed directly; **miss** = Redis GET (miss) + MongoDB + Redis SET; **hit** = Redis GET + JSON.parse",
    "",
  ];
  for (const d of r.results.datasets) {
    out.push(`## ${d.posts.toLocaleString()} posts`, "", `Ingestion (validation + NLP + MongoDB writes): ${d.ingest.durationMs} ms for ${d.ingest.imported} posts.`, "");
    out.push("| Query | Mongo avg | Mongo p50 | Mongo p95 | Miss p50 | Hit avg | Hit p50 | Hit p95 | Hit ratio | Speed-up (p50) |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const q of d.queries) out.push(`| ${q.name} | ${q.mongo.avgMs} | ${q.mongo.medianMs} | ${q.mongo.p95Ms} | ${q.cacheMiss.medianMs} | ${q.cacheHit.avgMs} | ${q.cacheHit.medianMs} | ${q.cacheHit.p95Ms} | ${q.hitRatio} | ${q.speedupMedian}x |`);
    out.push("", "Index effect (MongoDB-direct median, ms):", "", "| Query | All indexes | Only created_at index | No secondary indexes |", "|---|---|---|---|");
    for (const i of d.indexEffect) out.push(`| ${i.name} | ${i.allIndexesMedianMs} | ${i.onlyCreatedAtIndexMedianMs} | ${i.noSecondaryIndexesMedianMs} |`);
    const e = d.explain;
    out.push("", `Explain \`${e.indexed.query}\`: indexed plan ${e.indexed.stages.join(" <- ")}, keys examined ${e.indexed.totalKeysExamined}, docs examined ${e.indexed.totalDocsExamined}; unindexed plan ${e.unindexed.stages.join(" <- ")}, docs examined ${e.unindexed.totalDocsExamined}.`, "");
    if (d.workload) out.push(`Mixed workload: ${d.workload.requests} requests over ${d.workload.note}: hit ratio ${d.workload.hitRatio}, avg ${d.workload.latency.avgMs} ms, p50 ${d.workload.latency.medianMs} ms, p95 ${d.workload.latency.p95Ms} ms.`, "");
  }
  out.push("## Interpretation notes", "", "- Absolute numbers depend on hardware and on MongoDB and Redis running locally; with MongoDB Atlas over a network, MongoDB latency (and therefore the speed-up) would be higher.", "- A cache hit avoids the aggregation but still pays the Redis round trip and JSON parsing, which grows with payload size.", "- Cache misses are slightly slower than MongoDB-direct because they add a Redis GET and SET.", "");
  return out.join("\n");
}
