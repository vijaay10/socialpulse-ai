import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { MEDIA_TYPES, PLATFORMS, POST_SCHEMA_VERSION, SENTIMENT_LABELS } from "./constants.js";

const embeddedUser = new Schema(
  {
    user_id: { type: String, required: true },
    handle: { type: String, required: true },
    followers: { type: Number, min: 0, default: 0 },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const engagement = new Schema(
  {
    likes: { type: Number, min: 0, default: 0 },
    shares: { type: Number, min: 0, default: 0 },
    comments: { type: Number, min: 0, default: 0 },
    reach: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const media = new Schema(
  {
    type: { type: String, enum: MEDIA_TYPES, required: true },
    url: { type: String },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    duration_s: { type: Number, min: 0 },
  },
  { _id: false },
);

const sentiment = new Schema(
  {
    label: { type: String, enum: SENTIMENT_LABELS, required: true },
    score: { type: Number, min: -1, max: 1, required: true },
    confidence: { type: Number, min: 0, max: 1 },
    model: { type: String, required: true },
    model_version: { type: String, required: true },
    analyzed_at: { type: Date, required: true },
  },
  { _id: false },
);

const postSchema = new Schema(
  {
    post_id: { type: String, required: true, trim: true, maxlength: 200 },
    platform: { type: String, enum: PLATFORMS, required: true },
    schema_version: { type: Number, required: true, default: POST_SCHEMA_VERSION },
    user: { type: embeddedUser, required: true },
    user_ref: { type: Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true, maxlength: 5000 },
    hashtags: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    language: { type: String, default: "en", lowercase: true, maxlength: 10 },
    created_at: { type: Date, required: true },
    engagement: { type: engagement, required: true, default: () => ({}) },
    /** (likes + shares + comments) / reach * 100, precomputed at ingestion. */
    engagement_rate: { type: Number, min: 0, default: 0 },
    /** likes + shares + comments */
    interactions: { type: Number, min: 0, default: 0 },
    media: { type: [media], default: undefined },
    sentiment: { type: sentiment, required: true },
    source: {
      type: new Schema(
        {
          kind: { type: String, enum: ["upload", "seed", "api"], required: true },
          batch_id: { type: String, required: true },
          synthetic: { type: Boolean, default: false },
          file_name: { type: String },
        },
        { _id: false },
      ),
      required: true,
    },
    /** Platform-specific fields that are not part of the common model (schema flexibility). */
    extra: { type: Schema.Types.Mixed },
    ingested_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: { createdAt: "doc_created_at", updatedAt: "doc_updated_at" }, collection: "posts" },
);

// Duplicate-post prevention: a post id is unique within its platform.
postSchema.index({ platform: 1, post_id: 1 }, { unique: true, name: "uniq_platform_post" });
// Time-window queries and date-sorted listings.
postSchema.index({ created_at: -1 }, { name: "created_at_desc" });
// Multikey indexes for hashtag/topic trend queries within time windows.
postSchema.index({ hashtags: 1, created_at: -1 }, { name: "hashtags_created" });
postSchema.index({ topics: 1, created_at: -1 }, { name: "topics_created" });
postSchema.index({ platform: 1, created_at: -1 }, { name: "platform_created" });
postSchema.index({ "sentiment.label": 1, created_at: -1 }, { name: "sentiment_created" });
postSchema.index({ engagement_rate: -1 }, { name: "engagement_rate_desc" });
postSchema.index({ interactions: -1 }, { name: "interactions_desc" });
postSchema.index({ text: "text", hashtags: "text" }, { name: "text_search", weights: { text: 1, hashtags: 3 }, default_language: "none", language_override: "text_search_language" });

export type PostAttrs = InferSchemaType<typeof postSchema>;
export type PostDoc = HydratedDocument<PostAttrs>;
export const Post = model("Post", postSchema);
