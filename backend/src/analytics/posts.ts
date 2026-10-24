import { isValidObjectId } from "mongoose";
import { Comment } from "../models/Comment.js";
import { EngagementMetric } from "../models/EngagementMetric.js";
import { Post } from "../models/Post.js";
import { SentimentResult } from "../models/SentimentResult.js";
import { User } from "../models/User.js";
import { buildMatch, resolveRange, type Filters } from "./filters.js";

export const POST_SORTS = { recent: { created_at: -1 }, oldest: { created_at: 1 }, engagement: { interactions: -1 }, rate: { engagement_rate: -1 }, sentiment: { "sentiment.score": -1 } } as const;
export type PostSort = keyof typeof POST_SORTS;

export async function listPosts(f: Filters, opts: { page: number; limit: number; sort: PostSort; q?: string }) {
  // The posts listing applies a date filter only when one is explicitly requested.
  const hasDate = Boolean(f.from || f.to || f.window);
  const range = hasDate ? await resolveRange(f, "all") : null;
  const match = buildMatch(f, range ?? { from: null, to: new Date() }, { skipDate: !range });
  if (opts.q) match.$text = { $search: opts.q };
  const sort = { ...POST_SORTS[opts.sort], _id: 1 } as Record<string, 1 | -1>;
  const [total, items] = await Promise.all([
    Post.countDocuments(match),
    Post.find(match, { extra: 0, __v: 0 })
      .sort(sort)
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .lean(),
  ]);
  return {
    items,
    pagination: { page: opts.page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)), hasNext: opts.page * opts.limit < total },
  };
}

export async function getPostDetail(id: string) {
  const post = isValidObjectId(id) ? await Post.findById(id, { __v: 0 }).lean() : await Post.findOne({ post_id: id }, { __v: 0 }).lean();
  if (!post) return null;
  const [comments, sentimentHistory, engagementHistory, user] = await Promise.all([
    Comment.find({ post_ref: post._id }, { __v: 0 }).sort({ created_at: 1 }).limit(100).lean(),
    SentimentResult.find({ target_type: "post", target_ref: post._id }, { __v: 0 }).sort({ processed_at: -1 }).lean(),
    EngagementMetric.find({ post_ref: post._id }, { __v: 0 }).sort({ bucket: 1 }).lean(),
    post.user_ref ? User.findById(post.user_ref, { __v: 0 }).lean() : null,
  ]);
  return { post, comments, sentimentHistory, engagementHistory, author: user };
}
