import { Post } from "../models/Post.js";
import { autoInterval, buildMatch, describeRange, resolveRange, round, type Filters } from "./filters.js";

export const ENGAGEMENT_RATE_FORMULA = "engagement_rate (%) = (likes + shares + comments) / reach x 100";

/** Pearson correlation computed inside the pipeline from running sums. */
const pearsonGroup = (x: string, y: string) => ({
  _id: null,
  n: { $sum: 1 },
  sx: { $sum: x },
  sy: { $sum: y },
  sxx: { $sum: { $multiply: [x, x] } },
  syy: { $sum: { $multiply: [y, y] } },
  sxy: { $sum: { $multiply: [x, y] } },
});
const pearsonProject = {
  _id: 0,
  n: 1,
  r: {
    $let: {
      vars: {
        num: { $subtract: [{ $multiply: ["$n", "$sxy"] }, { $multiply: ["$sx", "$sy"] }] },
        den: {
          $sqrt: {
            $multiply: [
              { $subtract: [{ $multiply: ["$n", "$sxx"] }, { $multiply: ["$sx", "$sx"] }] },
              { $subtract: [{ $multiply: ["$n", "$syy"] }, { $multiply: ["$sy", "$sy"] }] },
            ],
          },
        },
      },
      in: { $cond: [{ $gt: ["$$den", 0] }, { $divide: ["$$num", "$$den"] }, null] },
    },
  },
};

const engagementGroup = {
  posts: { $sum: 1 },
  likes: { $sum: "$engagement.likes" },
  shares: { $sum: "$engagement.shares" },
  comments: { $sum: "$engagement.comments" },
  reach: { $sum: "$engagement.reach" },
  interactions: { $sum: "$interactions" },
  avgEngagementRate: { $avg: "$engagement_rate" },
  avgInteractions: { $avg: "$interactions" },
};

interface EngRow {
  _id: unknown;
  posts: number;
  likes: number;
  shares: number;
  comments: number;
  reach: number;
  interactions: number;
  avgEngagementRate: number;
  avgInteractions: number;
}

const shape = (r: EngRow) => ({
  posts: r.posts,
  likes: r.likes,
  shares: r.shares,
  comments: r.comments,
  reach: r.reach,
  interactions: r.interactions,
  avgInteractions: round(r.avgInteractions, 2),
  avgEngagementRate: round(r.avgEngagementRate),
  aggregateEngagementRate: r.reach ? round((r.interactions / r.reach) * 100) : null,
});

export async function getEngagementAnalytics(f: Filters, opts: { interval?: "hour" | "day" | "week"; topLimit: number }) {
  const range = await resolveRange(f);
  const unit = autoInterval(range, opts.interval);
  const [facet] = await Post.aggregate([
    { $match: buildMatch(f, range) },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              ...engagementGroup,
              avgLikes: { $avg: "$engagement.likes" },
              avgShares: { $avg: "$engagement.shares" },
              avgComments: { $avg: "$engagement.comments" },
              avgReach: { $avg: "$engagement.reach" },
            },
          },
        ],
        overTime: [{ $group: { _id: { $dateTrunc: { date: "$created_at", unit } }, ...engagementGroup } }, { $sort: { _id: 1 } }],
        byPlatform: [{ $group: { _id: "$platform", ...engagementGroup } }, { $sort: { interactions: -1 } }],
        byMediaType: [
          { $group: { _id: { $ifNull: [{ $arrayElemAt: ["$media.type", 0] }, "text"] }, ...engagementGroup } },
          { $sort: { avgEngagementRate: -1 } },
        ],
        bySentiment: [{ $group: { _id: "$sentiment.label", ...engagementGroup } }, { $sort: { _id: 1 } }],
        byHashtag: [
          { $unwind: "$hashtags" },
          { $group: { _id: "$hashtags", ...engagementGroup } },
          { $match: { posts: { $gte: 3 } } },
          { $sort: { interactions: -1, _id: 1 } },
          { $limit: 10 },
        ],
        topPosts: [
          { $sort: { interactions: -1, _id: 1 } },
          { $limit: opts.topLimit },
          { $project: { post_id: 1, platform: 1, text: 1, "user.handle": 1, "user.followers": 1, created_at: 1, engagement: 1, engagement_rate: 1, interactions: 1, hashtags: 1, "sentiment.label": 1, "sentiment.score": 1 } },
        ],
        corrSentimentRate: [{ $group: pearsonGroup("$sentiment.score", "$engagement_rate") }, { $project: pearsonProject }],
        corrAbsSentimentRate: [{ $group: pearsonGroup({ $abs: "$sentiment.score" } as unknown as string, "$engagement_rate") }, { $project: pearsonProject }],
        corrFollowersInteractions: [{ $group: pearsonGroup("$user.followers", "$interactions") }, { $project: pearsonProject }],
      },
    },
  ]);

  const t = facet.totals[0];
  const corr = (rows: { n: number; r: number | null }[]) => ({ n: rows[0]?.n ?? 0, r: round(rows[0]?.r ?? null) });
  return {
    range: describeRange(range),
    interval: unit,
    formula: ENGAGEMENT_RATE_FORMULA,
    totals: t
      ? { ...shape(t), avgLikes: round(t.avgLikes, 2), avgShares: round(t.avgShares, 2), avgComments: round(t.avgComments, 2), avgReach: round(t.avgReach, 2) }
      : { ...shape({ _id: null, posts: 0, likes: 0, shares: 0, comments: 0, reach: 0, interactions: 0, avgEngagementRate: NaN, avgInteractions: NaN }), avgLikes: null, avgShares: null, avgComments: null, avgReach: null },
    overTime: facet.overTime.map((r: EngRow) => ({ bucket: (r._id as Date).toISOString(), ...shape(r) })),
    byPlatform: facet.byPlatform.map((r: EngRow) => ({ platform: r._id, ...shape(r) })),
    byMediaType: facet.byMediaType.map((r: EngRow) => ({ mediaType: r._id, ...shape(r) })),
    bySentiment: facet.bySentiment.map((r: EngRow) => ({ label: r._id, ...shape(r) })),
    byHashtag: facet.byHashtag.map((r: EngRow) => ({ hashtag: r._id, ...shape(r) })),
    topPosts: facet.topPosts,
    correlations: {
      note: "Pearson r computed in the aggregation pipeline; |r| < 0.1 is negligible. Correlation is not causation.",
      sentimentScoreVsEngagementRate: corr(facet.corrSentimentRate),
      sentimentStrengthVsEngagementRate: corr(facet.corrAbsSentimentRate),
      followersVsInteractions: corr(facet.corrFollowersInteractions),
    },
  };
}
