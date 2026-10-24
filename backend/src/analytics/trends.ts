import type { PipelineStage } from "mongoose";
import { PLATFORMS } from "../models/constants.js";
import { Post } from "../models/Post.js";
import { Trend } from "../models/Trend.js";
import { autoInterval, buildMatch, describeRange, previousRange, resolveRange, round, WINDOWS, type Filters, type WindowKey } from "./filters.js";

export type TrendKind = "hashtag" | "topic";
const fieldFor = (kind: TrendKind) => (kind === "hashtag" ? "$hashtags" : "$topics");

/**
 * Two-period counting in one pass: documents from [prevFrom, to] are matched,
 * the array is unwound, and each key is counted separately for the current
 * window and the previous window of equal length.
 */
function periodCountStages(kind: TrendKind, from: Date, extraGroup: Record<string, unknown> = {}): PipelineStage.FacetPipelineStage[] {
  const isCurrent = { $gte: ["$created_at", from] };
  return [
    { $unwind: fieldFor(kind) },
    {
      $group: {
        _id: fieldFor(kind),
        current: { $sum: { $cond: [isCurrent, 1, 0] } },
        previous: { $sum: { $cond: [isCurrent, 0, 1] } },
        interactions: { $sum: { $cond: [isCurrent, "$interactions", 0] } },
        reach: { $sum: { $cond: [isCurrent, "$engagement.reach", 0] } },
        sentimentSum: { $sum: { $cond: [isCurrent, "$sentiment.score", 0] } },
        positive: { $sum: { $cond: [{ $and: [isCurrent, { $eq: ["$sentiment.label", "positive"] }] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $and: [isCurrent, { $eq: ["$sentiment.label", "negative"] }] }, 1, 0] } },
        platforms: { $addToSet: { $cond: [isCurrent, "$platform", null] } },
        ...extraGroup,
      },
    },
    {
      $addFields: {
        growth: { $cond: [{ $eq: ["$previous", 0] }, null, { $divide: [{ $subtract: ["$current", "$previous"] }, "$previous"] }] },
        avgSentiment: { $cond: [{ $gt: ["$current", 0] }, { $divide: ["$sentimentSum", "$current"] }, null] },
      },
    },
  ];
}

interface TrendRow {
  _id: string;
  current: number;
  previous: number;
  interactions: number;
  reach: number;
  growth: number | null;
  avgSentiment: number | null;
  positive: number;
  negative: number;
  platforms: string[];
}

const toItem = (r: TrendRow, rank: number) => ({
  rank,
  key: r._id,
  count: r.current,
  previousCount: r.previous,
  changePct: r.growth === null ? null : round(r.growth * 100, 2),
  status: r.previous === 0 ? "new" : r.current > r.previous ? "rising" : r.current < r.previous ? "falling" : "steady",
  interactions: r.interactions,
  engagementRate: r.reach ? round((r.interactions / r.reach) * 100) : null,
  avgSentiment: round(r.avgSentiment),
  positivePct: r.current ? round((r.positive / r.current) * 100, 2) : 0,
  negativePct: r.current ? round((r.negative / r.current) * 100, 2) : 0,
  platforms: r.platforms.filter(Boolean).sort(),
});

export async function getTrends(f: Filters, opts: { kind: TrendKind; limit: number; interval?: "hour" | "day" | "week" }) {
  const range = await resolveRange(f, "7d");
  const prev = previousRange(range);
  const field = fieldFor(opts.kind);
  // With "all" there is no previous period; count everything as current.
  const from = range.from ?? new Date(0);
  const match = buildMatch(f, prev ? { from: prev.from, to: range.to } : range);

  const [facet] = await Post.aggregate([
    { $match: match },
    {
      $facet: {
        overall: [...periodCountStages(opts.kind, from), { $match: { current: { $gt: 0 } } }, { $sort: { current: -1, _id: 1 } }, { $limit: opts.limit }],
        byPlatform: [
          { $match: { created_at: { $gte: from } } },
          { $unwind: field },
          { $group: { _id: { platform: "$platform", key: field }, count: { $sum: 1 }, interactions: { $sum: "$interactions" } } },
          { $sort: { count: -1, "_id.key": 1 } },
          { $group: { _id: "$_id.platform", items: { $push: { key: "$_id.key", count: "$count", interactions: "$interactions" } }, total: { $sum: "$count" } } },
          { $project: { items: { $slice: ["$items", 5] }, total: 1 } },
          { $sort: { total: -1 } },
        ],
      },
    },
  ]);

  const overall: ReturnType<typeof toItem>[] = facet.overall.map((r: TrendRow, i: number) => toItem(r, i + 1));
  const topKeys = overall.slice(0, 5).map((t) => t.key);
  const unit = autoInterval(range, opts.interval);
  const series = topKeys.length
    ? await Post.aggregate([
        { $match: { ...buildMatch(f, range), [field.slice(1)]: { $in: topKeys } } },
        { $unwind: field },
        { $match: { [field.slice(1)]: { $in: topKeys } } },
        { $group: { _id: { key: field, bucket: { $dateTrunc: { date: "$created_at", unit } } }, count: { $sum: 1 } } },
        { $sort: { "_id.bucket": 1 } },
      ])
    : [];

  const buckets = new Map<string, Record<string, number | string>>();
  for (const s of series as { _id: { key: string; bucket: Date }; count: number }[]) {
    const k = s._id.bucket.toISOString();
    const row = buckets.get(k) ?? { bucket: k, ...Object.fromEntries(topKeys.map((t) => [t, 0])) };
    row[s._id.key] = s.count;
    buckets.set(k, row);
  }

  return {
    kind: opts.kind,
    range: describeRange(range),
    previousRange: prev ? { from: prev.from.toISOString(), to: prev.to.toISOString() } : null,
    interval: unit,
    items: overall,
    byPlatform: facet.byPlatform.map((p: { _id: string; items: { key: string; count: number; interactions: number }[]; total: number }) => ({
      platform: p._id,
      total: p.total,
      items: p.items.map((it, i) => ({ rank: i + 1, ...it })),
    })),
    series: { keys: topKeys, points: [...buckets.values()] },
  };
}

export async function getRisingTrends(f: Filters, opts: { kind: TrendKind; limit: number; minCount: number }) {
  const range = await resolveRange({ ...f, window: f.window === "all" ? "7d" : f.window }, "7d");
  const prev = previousRange(range)!;
  const [facet] = await Post.aggregate([
    { $match: buildMatch(f, { from: prev.from, to: range.to }) },
    ...periodCountStages(opts.kind, range.from!),
    {
      $facet: {
        rising: [
          { $match: { current: { $gte: opts.minCount }, $expr: { $gt: ["$current", "$previous"] } } },
          // New keys (previous = 0) rank by volume after keys with measurable growth.
          { $addFields: { sortGrowth: { $ifNull: ["$growth", 1_000_000] } } },
          { $sort: { sortGrowth: -1, current: -1, _id: 1 } },
          { $limit: opts.limit },
        ],
        falling: [
          { $match: { previous: { $gte: opts.minCount }, $expr: { $lt: ["$current", "$previous"] } } },
          { $sort: { growth: 1, previous: -1, _id: 1 } },
          { $limit: opts.limit },
        ],
      },
    },
  ]);
  return {
    kind: opts.kind,
    range: describeRange(range),
    previousRange: { from: prev.from.toISOString(), to: prev.to.toISOString() },
    minCount: opts.minCount,
    growthFormula: "changePct = (current - previous) / previous x 100; keys absent in the previous window are marked 'new'",
    rising: facet.rising.map((r: TrendRow, i: number) => toItem(r, i + 1)),
    falling: facet.falling.map((r: TrendRow, i: number) => toItem(r, i + 1)),
  };
}

/** Recompute the materialised `trends` collection for the standard windows. */
export async function materializeTrends(limit = 20): Promise<number> {
  const computedAt = new Date();
  let written = 0;
  const windows = Object.keys(WINDOWS) as Exclude<WindowKey, "all">[];
  for (const kind of ["hashtag", "topic"] as TrendKind[]) {
    for (const window of windows) {
      for (const platform of ["all", ...PLATFORMS]) {
        const filters: Filters = { window, platform: platform === "all" ? undefined : [platform as (typeof PLATFORMS)[number]] };
        const result = await getTrends(filters, { kind, limit });
        const docs = result.items.map((it) => ({
          kind,
          window,
          window_start: new Date(result.range.from!),
          window_end: new Date(result.range.to),
          platform,
          key: it.key,
          rank: it.rank,
          frequency: it.count,
          previous_frequency: it.previousCount,
          growth: it.changePct,
          total_interactions: it.interactions,
          avg_sentiment: it.avgSentiment,
          computed_at: computedAt,
        }));
        await Trend.deleteMany({ kind, window, platform });
        if (docs.length) await Trend.insertMany(docs, { ordered: false });
        written += docs.length;
      }
    }
  }
  return written;
}

export async function getMaterializedTrends(opts: { kind: TrendKind; window: string; platform: string }) {
  const items = await Trend.find({ kind: opts.kind, window: opts.window, platform: opts.platform }, { _id: 0, __v: 0 }).sort({ rank: 1 }).lean();
  return { ...opts, computedAt: items[0]?.computed_at ?? null, items };
}
