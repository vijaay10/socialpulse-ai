export * from "./constants.js";
export { Post } from "./Post.js";
export { User } from "./User.js";
export { Hashtag } from "./Hashtag.js";
export { Comment } from "./Comment.js";
export { EngagementMetric } from "./EngagementMetric.js";
export { SentimentResult } from "./SentimentResult.js";
export { Trend } from "./Trend.js";
export { IngestionBatch } from "./IngestionBatch.js";
export { BenchmarkRun } from "./BenchmarkRun.js";

import { Post } from "./Post.js";
import { User } from "./User.js";
import { Hashtag } from "./Hashtag.js";
import { Comment } from "./Comment.js";
import { EngagementMetric } from "./EngagementMetric.js";
import { SentimentResult } from "./SentimentResult.js";
import { Trend } from "./Trend.js";
import { IngestionBatch } from "./IngestionBatch.js";
import { BenchmarkRun } from "./BenchmarkRun.js";

export const allModels = [Post, User, Hashtag, Comment, EngagementMetric, SentimentResult, Trend, IngestionBatch, BenchmarkRun];

/** Create collections and build indexes declared on the schemas. */
export async function syncIndexes(): Promise<void> {
  for (const m of allModels) {
    await m.createCollection().catch(() => undefined);
    await m.syncIndexes();
  }
}
