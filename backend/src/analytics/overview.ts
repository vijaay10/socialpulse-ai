import { Comment } from "../models/Comment.js";
import { Post } from "../models/Post.js";
import { buildMatch, describeRange, previousRange, resolveRange, round, type Filters } from "./filters.js";

export async function getOverview(f: Filters) {
  const range = await resolveRange(f);
  const match = buildMatch(f, range);
  const [facet] = await Post.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              posts: { $sum: 1 },
              likes: { $sum: "$engagement.likes" },
              shares: { $sum: "$engagement.shares" },
              comments: { $sum: "$engagement.comments" },
              reach: { $sum: "$engagement.reach" },
              interactions: { $sum: "$interactions" },
              avgEngagementRate: { $avg: "$engagement_rate" },
              avgSentiment: { $avg: "$sentiment.score" },
              first: { $min: "$created_at" },
              last: { $max: "$created_at" },
              synthetic: { $sum: { $cond: ["$source.synthetic", 1, 0] } },
            },
          },
        ],
        uniqueUsers: [{ $group: { _id: "$user.user_id" } }, { $count: "n" }],
        uniqueHashtags: [{ $unwind: "$hashtags" }, { $group: { _id: "$hashtags" } }, { $count: "n" }],
        sentiment: [{ $group: { _id: "$sentiment.label", count: { $sum: 1 } } }],
        platforms: [
          { $group: { _id: "$platform", posts: { $sum: 1 }, interactions: { $sum: "$interactions" }, reach: { $sum: "$engagement.reach" }, avgSentiment: { $avg: "$sentiment.score" } } },
          { $sort: { posts: -1 } },
        ],
        topHashtags: [{ $unwind: "$hashtags" }, { $group: { _id: "$hashtags", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 5 }],
        topTopics: [{ $unwind: "$topics" }, { $group: { _id: "$topics", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 5 }],
      },
    },
  ]);

  const prev = previousRange(range);
  const [prevTotals] = prev
    ? await Post.aggregate([
        { $match: buildMatch(f, prev) },
        { $match: { created_at: { $gte: prev.from, $lt: prev.to } } },
        { $group: { _id: null, posts: { $sum: 1 }, interactions: { $sum: "$interactions" }, reach: { $sum: "$engagement.reach" }, avgSentiment: { $avg: "$sentiment.score" } } },
      ])
    : [];

  const commentMatch: Record<string, unknown> = { created_at: range.from ? { $gte: range.from, $lte: range.to } : { $lte: range.to } };
  if (f.platform?.length) commentMatch.platform = { $in: f.platform };
  const storedComments = await Comment.countDocuments(commentMatch);

  const t = facet.totals[0] ?? { posts: 0, likes: 0, shares: 0, comments: 0, reach: 0, interactions: 0, avgEngagementRate: null, avgSentiment: null, first: null, last: null, synthetic: 0 };
  const dist = Object.fromEntries(["positive", "neutral", "negative"].map((l) => [l, 0])) as Record<string, number>;
  for (const s of facet.sentiment) dist[s._id] = s.count;
  // A % change against a nearly empty previous period is meaningless, so require a minimum baseline.
  const MIN_BASELINE_POSTS = 20;
  const prevPosts = prevTotals?.posts ?? 0;
  const change = (cur: number, before?: number) => (!before || prevPosts < MIN_BASELINE_POSTS ? null : round(((cur - before) / before) * 100, 2));

  return {
    range: describeRange(range),
    totals: {
      posts: t.posts,
      uniqueUsers: facet.uniqueUsers[0]?.n ?? 0,
      uniqueHashtags: facet.uniqueHashtags[0]?.n ?? 0,
      storedComments,
      likes: t.likes,
      shares: t.shares,
      comments: t.comments,
      reach: t.reach,
      interactions: t.interactions,
      avgEngagementRate: round(t.avgEngagementRate),
      aggregateEngagementRate: t.reach ? round((t.interactions / t.reach) * 100) : null,
      avgSentiment: round(t.avgSentiment),
      syntheticPosts: t.synthetic,
      firstPostAt: t.first,
      lastPostAt: t.last,
    },
    previousPeriod: prev
      ? {
          from: prev.from.toISOString(),
          to: prev.to.toISOString(),
          posts: prevTotals?.posts ?? 0,
          interactions: prevTotals?.interactions ?? 0,
          reach: prevTotals?.reach ?? 0,
          avgSentiment: round(prevTotals?.avgSentiment),
          postsChangePct: change(t.posts, prevTotals?.posts ?? 0),
          interactionsChangePct: change(t.interactions, prevTotals?.interactions ?? 0),
        }
      : null,
    sentiment: {
      distribution: dist,
      percentages: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, t.posts ? round((v / t.posts) * 100, 2) : 0])),
    },
    platforms: facet.platforms.map((p: { _id: string; posts: number; interactions: number; reach: number; avgSentiment: number }) => ({
      platform: p._id,
      posts: p.posts,
      interactions: p.interactions,
      reach: p.reach,
      engagementRate: p.reach ? round((p.interactions / p.reach) * 100) : null,
      avgSentiment: round(p.avgSentiment),
    })),
    topHashtags: facet.topHashtags.map((h: { _id: string; count: number }) => ({ hashtag: h._id, count: h.count })),
    topTopics: facet.topTopics.map((h: { _id: string; count: number }) => ({ topic: h._id, count: h.count })),
  };
}
