import { Post } from "../models/Post.js";
import { autoInterval, buildMatch, describeRange, resolveRange, round, type Filters } from "./filters.js";

const labelCounts = {
  total: { $sum: 1 },
  positive: { $sum: { $cond: [{ $eq: ["$sentiment.label", "positive"] }, 1, 0] } },
  neutral: { $sum: { $cond: [{ $eq: ["$sentiment.label", "neutral"] }, 1, 0] } },
  negative: { $sum: { $cond: [{ $eq: ["$sentiment.label", "negative"] }, 1, 0] } },
  avgScore: { $avg: "$sentiment.score" },
};

interface LabelRow {
  _id: unknown;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  avgScore: number;
}

const shape = (r: LabelRow) => ({
  total: r.total,
  positive: r.positive,
  neutral: r.neutral,
  negative: r.negative,
  positivePct: r.total ? round((r.positive / r.total) * 100, 2) : 0,
  neutralPct: r.total ? round((r.neutral / r.total) * 100, 2) : 0,
  negativePct: r.total ? round((r.negative / r.total) * 100, 2) : 0,
  avgScore: round(r.avgScore),
  /** Net sentiment = (positive - negative) / total, in [-1, 1]. */
  netSentiment: r.total ? round((r.positive - r.negative) / r.total) : null,
});

export async function getSentimentAnalytics(f: Filters, opts: { interval?: "hour" | "day" | "week"; hashtagLimit: number }) {
  const range = await resolveRange(f);
  const unit = autoInterval(range, opts.interval);
  const [facet] = await Post.aggregate([
    { $match: buildMatch(f, range) },
    {
      $facet: {
        overall: [{ $group: { _id: null, ...labelCounts } }],
        overTime: [{ $group: { _id: { $dateTrunc: { date: "$created_at", unit } }, ...labelCounts } }, { $sort: { _id: 1 } }],
        byPlatform: [{ $group: { _id: "$platform", ...labelCounts } }, { $sort: { total: -1 } }],
        byLanguage: [{ $group: { _id: "$language", ...labelCounts } }, { $sort: { total: -1 } }],
        byHashtag: [
          { $unwind: "$hashtags" },
          { $group: { _id: "$hashtags", ...labelCounts } },
          { $sort: { total: -1, _id: 1 } },
          { $limit: opts.hashtagLimit },
        ],
        byTopic: [{ $unwind: "$topics" }, { $group: { _id: "$topics", ...labelCounts } }, { $sort: { total: -1, _id: 1 } }],
        engagementBySentiment: [
          {
            $group: {
              _id: "$sentiment.label",
              posts: { $sum: 1 },
              avgEngagementRate: { $avg: "$engagement_rate" },
              avgInteractions: { $avg: "$interactions" },
              avgLikes: { $avg: "$engagement.likes" },
              avgShares: { $avg: "$engagement.shares" },
              avgComments: { $avg: "$engagement.comments" },
              totalInteractions: { $sum: "$interactions" },
              totalReach: { $sum: "$engagement.reach" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        model: [{ $group: { _id: { model: "$sentiment.model", version: "$sentiment.model_version" }, posts: { $sum: 1 } } }],
      },
    },
  ]);
  const empty: LabelRow = { _id: null, total: 0, positive: 0, neutral: 0, negative: 0, avgScore: 0 };
  return {
    range: describeRange(range),
    interval: unit,
    overall: shape(facet.overall[0] ?? empty),
    overTime: facet.overTime.map((r: LabelRow) => ({ bucket: (r._id as Date).toISOString(), ...shape(r) })),
    byPlatform: facet.byPlatform.map((r: LabelRow) => ({ platform: r._id, ...shape(r) })),
    byLanguage: facet.byLanguage.map((r: LabelRow) => ({ language: r._id, ...shape(r) })),
    byHashtag: facet.byHashtag.map((r: LabelRow) => ({ hashtag: r._id, ...shape(r) })),
    byTopic: facet.byTopic.map((r: LabelRow) => ({ topic: r._id, ...shape(r) })),
    engagementBySentiment: facet.engagementBySentiment.map((r: Record<string, number> & { _id: string }) => ({
      label: r._id,
      posts: r.posts,
      avgEngagementRate: round(r.avgEngagementRate),
      aggregateEngagementRate: r.totalReach ? round((r.totalInteractions / r.totalReach) * 100) : null,
      avgInteractions: round(r.avgInteractions, 2),
      avgLikes: round(r.avgLikes, 2),
      avgShares: round(r.avgShares, 2),
      avgComments: round(r.avgComments, 2),
    })),
    models: facet.model.map((m: { _id: { model: string; version: string }; posts: number }) => ({ ...m._id, posts: m.posts })),
    thresholds: { positive: "compound >= 0.05", negative: "compound <= -0.05", neutral: "otherwise" },
  };
}
