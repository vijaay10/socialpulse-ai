/** Usage: npm run seed -- --count 5000 --seed 42 --days 30 [--reset true] */
import { disconnectMongo } from "../db/mongo.js";
import { ingestRecords } from "../ingestion/pipeline.js";
import { generateSyntheticPosts } from "../ingestion/synthetic.js";
import { allModels, IngestionBatch, BenchmarkRun } from "../models/index.js";
import { arg, bootstrap } from "./cli.js";

const ctx = await bootstrap();
const count = Number(arg("count", "5000"));
const seed = Number(arg("seed", "42"));
const days = Number(arg("days", "30"));
if (arg("reset", "false") === "true") {
  for (const m of allModels) if (m !== IngestionBatch && m !== BenchmarkRun) await (m as typeof IngestionBatch).deleteMany({});
  await ctx.cache.invalidate([], "seed reset");
  console.log("Existing social data deleted");
}
const report = await ingestRecords(generateSyntheticPosts({ count, seed, days }), { kind: "seed", format: "synthetic", synthetic: true, fileName: `synthetic(seed=${seed},count=${count})` }, ctx);
console.log(JSON.stringify({ ...report, errors: report.errors.slice(0, 5) }, null, 2));
await ctx.cache.close();
await disconnectMongo();
