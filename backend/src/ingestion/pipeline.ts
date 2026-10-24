import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import type { CacheService } from "../cache/cacheService.js";
import { materializeTrends } from "../analytics/trends.js";
import { logger } from "../logger.js";
import { Comment, EngagementMetric, Hashtag, IngestionBatch, Post, POST_SCHEMA_VERSION, SentimentResult, User } from "../models/index.js";
import { NlpUnavailableError, type NlpResult, type SentimentAnalyzer } from "../nlp/nlpClient.js";
import { normalizeRecord, type NormalizedPost } from "./normalize.js";

export interface IngestSource {
  kind: "upload" | "seed" | "api";
  fileName?: string;
  format?: string;
  synthetic?: boolean;
}

export interface IngestError {
  index: number;
  post_id?: string;
  reason: string;
}

export interface IngestReport {
  batchId: string;
  source: IngestSource;
  received: number;
  /** Records that passed validation and were checked against the database. */
  processed: number;
  imported: number;
  /** Duplicates (within the batch or already stored). */
  skipped: number;
  failed: number;
  commentsImported: number;
  sentiment: { positive: number; neutral: number; negative: number };
  errors: IngestError[];
  errorsTruncated: boolean;
  cache: { invalidatedKeys: number };
  trendsMaterialized: number;
  durationMs: number;
}

export interface IngestDeps {
  nlp: SentimentAnalyzer;
  cache: CacheService;
}

const MAX_REPORTED_ERRORS = 100;
const CHUNK = 1000;
const HOUR = 3_600_000;

export async function ingestRecords(records: unknown[], source: IngestSource, deps: IngestDeps): Promise<IngestReport> {
  const started = Date.now();
  const batchId = `${source.kind}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const report: IngestReport = {
    batchId,
    source,
    received: records.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    commentsImported: 0,
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    errors: [],
    errorsTruncated: false,
    cache: { invalidatedKeys: 0 },
    trendsMaterialized: 0,
    durationMs: 0,
  };
  const fail = (index: number, reason: string, post_id?: string) => {
    report.failed++;
    if (report.errors.length < MAX_REPORTED_ERRORS) report.errors.push({ index, post_id, reason });
    else report.errorsTruncated = true;
  };

  // 1. Validate and normalise; drop duplicates inside the batch.
  const valid: { index: number; post: NormalizedPost }[] = [];
  const seen = new Set<string>();
  const now = new Date();
  records.forEach((raw, index) => {
    if (raw && typeof raw === "object" && "__parse_error" in raw) return fail(index, String((raw as { __parse_error: string }).__parse_error));
    const res = normalizeRecord(raw, now);
    if (!res.ok) return fail(index, res.reason, res.post_id);
    const key = `${res.post.platform}:${res.post.post_id}`;
    report.processed++;
    if (seen.has(key)) {
      report.skipped++;
      return;
    }
    seen.add(key);
    valid.push({ index, post: res.post });
  });

  for (let i = 0; i < valid.length; i += CHUNK) {
    await ingestChunk(valid.slice(i, i + CHUNK), source, batchId, deps, report, fail);
  }

  // 2. Derived data and cache invalidation only when MongoDB actually changed.
  if (report.imported > 0) {
    try {
      report.trendsMaterialized = await materializeTrends();
    } catch (err) {
      logger.error({ err }, "Trend materialisation failed");
    }
    const inv = await deps.cache.invalidate(["analytics:", "posts:"], `ingestion ${batchId}`);
    report.cache.invalidatedKeys = inv.deleted;
  }
  report.durationMs = Date.now() - started;

  await IngestionBatch.create({
    batch_id: batchId,
    kind: source.kind,
    file_name: source.fileName,
    format: source.format,
    synthetic: Boolean(source.synthetic),
    status: report.imported > 0 || report.failed === 0 ? "completed" : "failed",
    received: report.received,
    processed: report.processed,
    imported: report.imported,
    skipped: report.skipped,
    failed: report.failed,
    comments_imported: report.commentsImported,
    errors: report.errors.slice(0, 50),
    cache_keys_invalidated: report.cache.invalidatedKeys,
    duration_ms: report.durationMs,
    started_at: new Date(started),
    finished_at: new Date(),
  });
  logger.info({ batchId, received: report.received, imported: report.imported, skipped: report.skipped, failed: report.failed, ms: report.durationMs }, "Ingestion finished");
  return report;
}

async function ingestChunk(
  chunk: { index: number; post: NormalizedPost }[],
  source: IngestSource,
  batchId: string,
  deps: IngestDeps,
  report: IngestReport,
  fail: (index: number, reason: string, post_id?: string) => void,
) {
  // Skip posts that already exist (duplicate-post prevention against MongoDB).
  const existing = await Post.find({ $or: chunk.map(({ post }) => ({ platform: post.platform, post_id: post.post_id })) }, { platform: 1, post_id: 1 }).lean();
  const existingKeys = new Set(existing.map((e) => `${e.platform}:${e.post_id}`));
  const fresh = chunk.filter(({ post }) => {
    if (existingKeys.has(`${post.platform}:${post.post_id}`)) {
      report.skipped++;
      return false;
    }
    return true;
  });
  if (!fresh.length) return;

  // Sentiment for posts and their replies in one batched call to the NLP service.
  let nlp: Map<string, NlpResult>;
  try {
    const items = fresh.flatMap(({ post }) => [
      { id: `p:${post.platform}:${post.post_id}`, text: post.text, language: post.language },
      ...post.replies.map((c) => ({ id: `c:${post.platform}:${c.comment_id}`, text: c.text, language: post.language })),
    ]);
    nlp = new Map((await deps.nlp.analyzeBatch(items)).map((r) => [r.id, r]));
  } catch (err) {
    const reason = err instanceof NlpUnavailableError ? err.message : `sentiment analysis failed: ${(err as Error).message}`;
    for (const { index, post } of fresh) fail(index, reason, post.post_id);
    return;
  }

  const analyzedAt = new Date();
  const withSentiment = fresh.filter(({ index, post }) => {
    const r = nlp.get(`p:${post.platform}:${post.post_id}`);
    if (!r || r.error) {
      fail(index, `sentiment analysis failed: ${r?.error ?? "no result"}`, post.post_id);
      return false;
    }
    return true;
  });
  if (!withSentiment.length) return;

  // Users: upsert profiles and keep a reference on each post.
  const userOps = new Map<string, NormalizedPost>();
  for (const { post } of withSentiment) {
    const k = `${post.platform}:${post.user.user_id}`;
    const prev = userOps.get(k);
    if (!prev || prev.created_at < post.created_at) userOps.set(k, post);
  }
  const postsPerUser = new Map<string, { count: number; first: Date; last: Date }>();
  for (const { post } of withSentiment) {
    const k = `${post.platform}:${post.user.user_id}`;
    const agg = postsPerUser.get(k) ?? { count: 0, first: post.created_at, last: post.created_at };
    agg.count++;
    if (post.created_at < agg.first) agg.first = post.created_at;
    if (post.created_at > agg.last) agg.last = post.created_at;
    postsPerUser.set(k, agg);
  }
  await User.bulkWrite(
    [...userOps.entries()].map(([k, post]) => {
      const agg = postsPerUser.get(k)!;
      return {
        updateOne: {
          filter: { platform: post.platform, user_id: post.user.user_id },
          update: {
            $set: { handle: post.user.handle, followers: post.user.followers, verified: post.user.verified },
            $inc: { post_count: agg.count },
            $min: { first_seen: agg.first },
            $max: { last_seen: agg.last },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
  const users = await User.find({ $or: [...userOps.values()].map((p) => ({ platform: p.platform, user_id: p.user.user_id })) }, { platform: 1, user_id: 1 }).lean();
  const userIds = new Map(users.map((u) => [`${u.platform}:${u.user_id}`, u._id]));

  const docs = withSentiment.map(({ post }) => {
    const r = nlp.get(`p:${post.platform}:${post.post_id}`)!;
    return {
      post_id: post.post_id,
      platform: post.platform,
      schema_version: POST_SCHEMA_VERSION,
      user: post.user,
      user_ref: userIds.get(`${post.platform}:${post.user.user_id}`),
      text: post.text,
      hashtags: post.hashtags,
      topics: post.topics,
      language: post.language,
      created_at: post.created_at,
      engagement: post.engagement,
      engagement_rate: post.engagement_rate,
      interactions: post.interactions,
      ...(post.media ? { media: post.media } : {}),
      sentiment: { label: r.label, score: r.score, confidence: r.confidence, model: r.model, model_version: r.model_version, analyzed_at: analyzedAt },
      source: { kind: source.kind, batch_id: batchId, synthetic: Boolean(source.synthetic), file_name: source.fileName },
      extra: post.extra,
      ingested_at: analyzedAt,
    };
  });

  // Bulk insert; unordered so one bad/duplicate document does not stop the rest.
  let inserted: { _id: Types.ObjectId; platform: string; post_id: string }[] = [];
  try {
    inserted = (await Post.insertMany(docs, { ordered: false, lean: true })) as unknown as typeof inserted;
  } catch (err) {
    const e = err as { insertedDocs?: typeof inserted; writeErrors?: { index: number; code?: number; errmsg?: string; err?: { code?: number; errmsg?: string } }[] };
    inserted = e.insertedDocs ?? [];
    for (const we of e.writeErrors ?? []) {
      const code = we.code ?? we.err?.code;
      const item = withSentiment[we.index];
      if (code === 11000) report.skipped++;
      else fail(item?.index ?? -1, `insert failed: ${we.errmsg ?? we.err?.errmsg ?? "unknown"}`, item?.post.post_id);
    }
    if (!e.writeErrors) throw err;
  }
  report.imported += inserted.length;
  if (!inserted.length) return;

  const byKey = new Map(withSentiment.map((w) => [`${w.post.platform}:${w.post.post_id}`, w.post]));
  const sentimentDocs: Record<string, unknown>[] = [];
  const engagementDocs: Record<string, unknown>[] = [];
  const commentDocs: Record<string, unknown>[] = [];
  const tagStats = new Map<string, { count: number; first: Date; last: Date; platforms: Set<string> }>();

  for (const doc of inserted) {
    const post = byKey.get(`${doc.platform}:${doc.post_id}`)!;
    const r = nlp.get(`p:${post.platform}:${post.post_id}`)!;
    report.sentiment[r.label]++;
    sentimentDocs.push({
      target_type: "post", target_ref: doc._id, target_id: post.post_id, platform: post.platform,
      label: r.label, score: r.score, confidence: r.confidence, positive: r.positive, neutral: r.neutral, negative: r.negative,
      clean_text: r.clean_text, warnings: r.warnings ?? undefined, model: r.model, model_version: r.model_version, processed_at: analyzedAt,
    });
    const snapshots = post.engagement_history ?? [{ at: analyzedAt, ...post.engagement }];
    const buckets = new Map<number, (typeof snapshots)[number]>();
    for (const s of snapshots) buckets.set(Math.floor(s.at.getTime() / HOUR) * HOUR, s);
    for (const [bucket, s] of buckets) {
      engagementDocs.push({ post_ref: doc._id, post_id: post.post_id, platform: post.platform, bucket: new Date(bucket), likes: s.likes, shares: s.shares, comments: s.comments, reach: s.reach });
    }
    for (const c of post.replies) {
      const cr = nlp.get(`c:${post.platform}:${c.comment_id}`);
      if (!cr || cr.error) continue;
      commentDocs.push({
        comment_id: c.comment_id, platform: post.platform, post_id: post.post_id, post_ref: doc._id, user: c.user, text: c.text, created_at: c.created_at,
        sentiment: { label: cr.label, score: cr.score, model: cr.model },
      });
    }
    for (const tag of post.hashtags) {
      const t = tagStats.get(tag) ?? { count: 0, first: post.created_at, last: post.created_at, platforms: new Set<string>() };
      t.count++;
      if (post.created_at < t.first) t.first = post.created_at;
      if (post.created_at > t.last) t.last = post.created_at;
      t.platforms.add(post.platform);
      tagStats.set(tag, t);
    }
  }

  await Promise.all([
    insertIgnoringDuplicates(SentimentResult, sentimentDocs),
    insertIgnoringDuplicates(EngagementMetric, engagementDocs),
    Hashtag.bulkWrite(
      [...tagStats.entries()].map(([tag, t]) => ({
        updateOne: {
          filter: { tag },
          update: { $inc: { total_count: t.count }, $min: { first_seen: t.first }, $max: { last_seen: t.last }, $addToSet: { platforms: { $each: [...t.platforms] } } },
          upsert: true,
        },
      })),
      { ordered: false },
    ),
  ]);
  const insertedComments = await insertIgnoringDuplicates(Comment, commentDocs);
  report.commentsImported += insertedComments;
  // Comment sentiment history.
  if (insertedComments) {
    const stored = await Comment.find({ post_ref: { $in: inserted.map((d) => d._id) } }, { comment_id: 1, platform: 1 }).lean();
    await insertIgnoringDuplicates(
      SentimentResult,
      stored.flatMap((c) => {
        const cr = nlp.get(`c:${c.platform}:${c.comment_id}`);
        return cr
          ? [{ target_type: "comment", target_ref: c._id, target_id: c.comment_id, platform: c.platform, label: cr.label, score: cr.score, confidence: cr.confidence, positive: cr.positive, neutral: cr.neutral, negative: cr.negative, clean_text: cr.clean_text, warnings: cr.warnings ?? undefined, model: cr.model, model_version: cr.model_version, processed_at: analyzedAt }]
          : [];
      }),
    );
  }
}

async function insertIgnoringDuplicates(model: { insertMany: (docs: Record<string, unknown>[], opts: object) => Promise<unknown[]> }, docs: Record<string, unknown>[]): Promise<number> {
  if (!docs.length) return 0;
  try {
    return (await model.insertMany(docs, { ordered: false, lean: true })).length;
  } catch (err) {
    const e = err as { insertedDocs?: unknown[]; writeErrors?: { code?: number; err?: { code?: number } }[] };
    if (!e.writeErrors || e.writeErrors.some((w) => (w.code ?? w.err?.code) !== 11000)) throw err;
    return e.insertedDocs?.length ?? docs.length - e.writeErrors.length;
  }
}
