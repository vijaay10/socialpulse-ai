import { Schema, model } from "mongoose";

/** Materialised trend rankings, produced by aggregation after each ingestion. */
const trendSchema = new Schema(
  {
    kind: { type: String, enum: ["hashtag", "topic"], required: true },
    window: { type: String, required: true },
    window_start: { type: Date, required: true },
    window_end: { type: Date, required: true },
    platform: { type: String, required: true, default: "all" },
    key: { type: String, required: true },
    rank: { type: Number, required: true, min: 1 },
    frequency: { type: Number, required: true, min: 0 },
    previous_frequency: { type: Number, required: true, min: 0 },
    growth: { type: Number },
    total_interactions: { type: Number, min: 0, default: 0 },
    avg_sentiment: { type: Number },
    computed_at: { type: Date, required: true },
  },
  { collection: "trends" },
);

trendSchema.index({ kind: 1, window: 1, platform: 1, rank: 1 }, { unique: true, name: "uniq_kind_window_platform_rank" });
trendSchema.index({ computed_at: -1 }, { name: "computed_at_desc" });

export const Trend = model("Trend", trendSchema);
