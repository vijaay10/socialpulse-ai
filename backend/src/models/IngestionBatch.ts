import { Schema, model } from "mongoose";

const ingestionBatchSchema = new Schema(
  {
    batch_id: { type: String, required: true },
    kind: { type: String, enum: ["upload", "seed", "api"], required: true },
    file_name: { type: String },
    format: { type: String },
    synthetic: { type: Boolean, default: false },
    status: { type: String, enum: ["completed", "failed"], required: true },
    received: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    comments_imported: { type: Number, default: 0 },
    errors: { type: [{ index: Number, post_id: String, reason: String, _id: false }], default: [] },
    cache_keys_invalidated: { type: Number, default: 0 },
    duration_ms: { type: Number },
    started_at: { type: Date, required: true },
    finished_at: { type: Date },
  },
  { collection: "ingestion_batches", suppressReservedKeysWarning: true },
);

ingestionBatchSchema.index({ batch_id: 1 }, { unique: true });
ingestionBatchSchema.index({ started_at: -1 });

export const IngestionBatch = model("IngestionBatch", ingestionBatchSchema);
