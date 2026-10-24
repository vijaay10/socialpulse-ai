import { Schema, model } from "mongoose";
import { PLATFORMS, SENTIMENT_LABELS } from "./constants.js";

const commentSchema = new Schema(
  {
    comment_id: { type: String, required: true, trim: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    post_id: { type: String, required: true },
    post_ref: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user: {
      user_id: { type: String, required: true },
      handle: { type: String, required: true },
    },
    text: { type: String, required: true, maxlength: 5000 },
    created_at: { type: Date, required: true },
    sentiment: {
      label: { type: String, enum: SENTIMENT_LABELS, required: true },
      score: { type: Number, min: -1, max: 1, required: true },
      model: { type: String, required: true },
    },
  },
  { timestamps: true, collection: "comments" },
);

commentSchema.index({ platform: 1, comment_id: 1 }, { unique: true, name: "uniq_platform_comment" });
commentSchema.index({ post_ref: 1, created_at: -1 }, { name: "post_created" });

export const Comment = model("Comment", commentSchema);
