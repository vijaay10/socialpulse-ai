import { Schema, model } from "mongoose";
import { PLATFORMS } from "./constants.js";

const userSchema = new Schema(
  {
    user_id: { type: String, required: true, trim: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    handle: { type: String, required: true, trim: true },
    followers: { type: Number, min: 0, default: 0 },
    verified: { type: Boolean, default: false },
    post_count: { type: Number, min: 0, default: 0 },
    first_seen: { type: Date, required: true },
    last_seen: { type: Date, required: true },
  },
  { timestamps: true, collection: "users" },
);

userSchema.index({ platform: 1, user_id: 1 }, { unique: true, name: "uniq_platform_user" });
userSchema.index({ followers: -1 }, { name: "followers_desc" });

export const User = model("User", userSchema);
