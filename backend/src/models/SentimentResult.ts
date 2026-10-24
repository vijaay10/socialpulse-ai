import { Schema, model } from "mongoose";
import { SENTIMENT_LABELS } from "./constants.js";

/** Historical NLP output; one result per target per model version. */
const sentimentResultSchema = new Schema(
  {
    target_type: { type: String, enum: ["post", "comment"], required: true },
    target_ref: { type: Schema.Types.ObjectId, required: true },
    target_id: { type: String, required: true },
    platform: { type: String, required: true },
    label: { type: String, enum: SENTIMENT_LABELS, required: true },
    score: { type: Number, min: -1, max: 1, required: true },
    confidence: { type: Number, min: 0, max: 1 },
    positive: { type: Number, min: 0, max: 1 },
    neutral: { type: Number, min: 0, max: 1 },
    negative: { type: Number, min: 0, max: 1 },
    clean_text: { type: String },
    warnings: { type: [String], default: undefined },
    model: { type: String, required: true },
    model_version: { type: String, required: true },
    processed_at: { type: Date, required: true },
  },
  { timestamps: true, collection: "sentiment_results" },
);

sentimentResultSchema.index(
  { target_type: 1, target_ref: 1, model_version: 1 },
  { unique: true, name: "uniq_target_model" },
);
sentimentResultSchema.index({ label: 1, processed_at: -1 }, { name: "label_processed" });

export const SentimentResult = model("SentimentResult", sentimentResultSchema);
