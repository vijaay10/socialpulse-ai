import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { ingestRecords } from "../ingestion/pipeline.js";
import { detectFormat, parseUpload } from "../ingestion/parsers.js";
import { generateSyntheticPosts } from "../ingestion/synthetic.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { syncIndexes, Comment, EngagementMetric, Hashtag, Post, SentimentResult, Trend, User } from "../models/index.js";
import { IngestionBatch } from "../models/IngestionBatch.js";

export function ingestionRouter(ctx: AppContext) {
  const r = Router();
  const admin = requireAdmin(ctx.config.ADMIN_API_KEY);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ctx.config.UPLOAD_MAX_MB * 1024 * 1024, files: 1 } });

  r.post("/upload", admin, upload.single("file"), async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded: send multipart/form-data with a 'file' field");
    const format = detectFormat(req.file.originalname, req.file.mimetype);
    if (!format) throw new HttpError(415, "Unsupported file type: upload a .csv, .json, .ndjson or .jsonl file");
    const content = req.file.buffer.toString("utf8");
    if (!content.trim()) throw new HttpError(400, "Uploaded file is empty");
    const records = parseUpload(content, format);
    if (records.length === 0) throw new HttpError(400, "Uploaded file contains no records");
    if (records.length > 100_000) throw new HttpError(413, "Too many records in one upload (max 100000)");
    const report = await ingestRecords(records, { kind: "upload", fileName: req.file.originalname, format }, ctx);
    res.status(report.imported > 0 ? 201 : 200).json({ data: report });
  });

  r.post("/seed", admin, async (req, res) => {
    const body = z
      .object({
        count: z.coerce.number().int().min(1).max(50_000).default(2000),
        seed: z.coerce.number().int().min(0).max(1_000_000).default(42),
        days: z.coerce.number().int().min(1).max(365).default(30),
        reset: z.preprocess((v) => v === true || v === "true" || v === 1 || v === "1", z.boolean()).default(false),
      })
      .parse(req.body ?? {});
    if (body.reset) await resetData(ctx);
    const records = generateSyntheticPosts({ count: body.count, seed: body.seed, days: body.days });
    const report = await ingestRecords(records, { kind: "seed", format: "synthetic", synthetic: true, fileName: `synthetic(seed=${body.seed},count=${body.count})` }, ctx);
    res.status(report.imported > 0 ? 201 : 200).json({ data: { ...report, synthetic: true, reset: body.reset } });
  });

  r.get("/batches", async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
    const items = await IngestionBatch.find({}, { _id: 0, __v: 0 }).sort({ started_at: -1 }).limit(limit).lean();
    res.json({ data: items });
  });

  r.delete("/data", admin, async (_req, res) => {
    const deleted = await resetData(ctx);
    res.json({ data: deleted });
  });

  return r;
}

async function resetData(ctx: AppContext) {
  const models = { posts: Post, users: User, hashtags: Hashtag, comments: Comment, engagement_metrics: EngagementMetric, sentiment_results: SentimentResult, trends: Trend };
  const deleted: Record<string, number> = {};
  for (const [name, m] of Object.entries(models)) deleted[name] = (await (m as typeof Post).deleteMany({})).deletedCount;
  await syncIndexes();
  const inv = await ctx.cache.invalidate([], "data reset");
  return { deleted, cacheKeysInvalidated: inv.deleted };
}
