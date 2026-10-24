import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { environment, explainTrendQuery, runQueryBenchmarks, runWorkload } from "../benchmark/runner.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { BenchmarkRun } from "../models/BenchmarkRun.js";

let running = false;

export function benchmarkRouter(ctx: AppContext) {
  const r = Router();
  const admin = requireAdmin(ctx.config.ADMIN_API_KEY);

  r.get("/results", async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(req.query.limit);
    const items = await BenchmarkRun.find({}, { _id: 0, __v: 0 }).sort({ created_at: -1 }).limit(limit).lean();
    res.json({ data: items });
  });

  /** Runs a quick benchmark against the live database (the CLI covers dataset sizes and index effects). */
  r.post("/run", admin, async (req, res) => {
    const opts = z
      .object({
        iterations: z.coerce.number().int().min(5).max(200).default(30),
        warmup: z.coerce.number().int().min(0).max(50).default(5),
        workloadRequests: z.coerce.number().int().min(0).max(2000).default(200),
      })
      .parse(req.body ?? {});
    if (running) throw new HttpError(409, "A benchmark is already running");
    running = true;
    try {
      const benchCache = ctx.cache.withPrefix(`${ctx.cache.prefix}:bench`);
      const conditions = await environment(opts);
      if (!conditions.posts) throw new HttpError(409, "No posts in the database: seed or upload data first");
      const queries = await runQueryBenchmarks(benchCache, opts);
      const workload = opts.workloadRequests ? await runWorkload(benchCache, opts.workloadRequests) : null;
      const explain = await explainTrendQuery();
      const doc = await BenchmarkRun.create({
        run_id: `api_${Date.now()}_${randomUUID().slice(0, 6)}`,
        source: "api",
        conditions,
        results: { datasets: [{ posts: conditions.posts, indexed: true, queries, workload, explain }] },
      });
      res.status(201).json({ data: doc.toObject() });
    } finally {
      running = false;
    }
  });
  return r;
}
