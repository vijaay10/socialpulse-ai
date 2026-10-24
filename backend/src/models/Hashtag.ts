import { Schema, model } from "mongoose";

/** Normalised hashtag registry; rolling counters are updated at ingestion time. */
const hashtagSchema = new Schema(
  {
    tag: { type: String, required: true, lowercase: true, trim: true, maxlength: 100 },
    total_count: { type: Number, min: 0, default: 0 },
    platforms: { type: [String], default: [] },
    first_seen: { type: Date, required: true },
    last_seen: { type: Date, required: true },
  },
  { timestamps: true, collection: "hashtags" },
);

hashtagSchema.index({ tag: 1 }, { unique: true, name: "uniq_tag" });
hashtagSchema.index({ total_count: -1 }, { name: "total_count_desc" });
hashtagSchema.index({ last_seen: -1 }, { name: "last_seen_desc" });

export const Hashtag = model("Hashtag", hashtagSchema);
