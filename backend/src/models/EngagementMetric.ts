import { Schema, model } from "mongoose";
import { PLATFORMS } from "./constants.js";

/** Time-bucketed engagement snapshots (one document per post per hour bucket). */
const engagementMetricSchema = new Schema(
  {
    post_ref: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    post_id: { type: String, required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    bucket: { type: Date, required: true },
    likes: { type: Number, min: 0, default: 0 },
    shares: { type: Number, min: 0, default: 0 },
    comments: { type: Number, min: 0, default: 0 },
    reach: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, collection: "engagement_metrics" },
);

engagementMetricSchema.index({ post_ref: 1, bucket: 1 }, { unique: true, name: "uniq_post_bucket" });
engagementMetricSchema.index({ platform: 1, bucket: -1 }, { name: "platform_bucket" });

export const EngagementMetric = model("EngagementMetric", engagementMetricSchema);
