/** Writes SYNTHETIC sample upload files into ../sample-data. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateSyntheticPosts } from "../ingestion/synthetic.js";

const outDir = path.resolve(process.cwd(), "../sample-data");
mkdirSync(outDir, { recursive: true });

const csvRows = generateSyntheticPosts({ count: 300, seed: 7, idPrefix: "sample_csv" });
const columns = ["post_id", "platform", "text", "hashtags", "created_at", "user_id", "handle", "followers", "verified", "likes", "shares", "comments", "reach", "language", "media_type", "media_url"];
const esc = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = [columns.join(",")];
for (const r of csvRows) {
  const u = r.user as { user_id: string; handle: string; followers: number; verified: boolean };
  const e = r.engagement as Record<string, number>;
  const m = (r.media as { type: string; url: string }[] | undefined)?.[0];
  lines.push(
    [r.post_id, r.platform, r.text, (r.hashtags as string[]).join(" "), r.created_at, u.user_id, u.handle, u.followers, u.verified, e.likes, e.shares, e.comments, e.reach, r.language, m?.type, m?.url]
      .map(esc)
      .join(","),
  );
}
writeFileSync(path.join(outDir, "sample-posts.csv"), lines.join("\n") + "\n");

const jsonRows = generateSyntheticPosts({ count: 300, seed: 8, idPrefix: "sample_json" });
writeFileSync(path.join(outDir, "sample-posts.json"), JSON.stringify({ synthetic: true, description: "SYNTHETIC SocialPulse sample dataset (not real social-media data)", posts: jsonRows }, null, 2));

const valid = jsonRows[0];
const invalid = [
  { ...valid, post_id: "sample_invalid_ok_1" },
  { ...valid, post_id: "sample_invalid_ok_1" },
  { post_id: "sample_invalid_2", platform: "myspace", text: "unknown platform", created_at: "2026-10-01T10:00:00Z", user_id: "u1" },
  { post_id: "sample_invalid_3", platform: "twitter", text: "", created_at: "2026-10-01T10:00:00Z", user_id: "u1" },
  { post_id: "sample_invalid_4", platform: "twitter", text: "bad date", created_at: "not-a-date", user_id: "u1" },
  { post_id: "sample_invalid_5", platform: "twitter", text: "negative likes", created_at: "2026-10-01T10:00:00Z", user_id: "u1", likes: -5 },
  { platform: "twitter", text: "missing id", created_at: "2026-10-01T10:00:00Z", user_id: "u1" },
  "not an object",
];
writeFileSync(path.join(outDir, "invalid-posts.json"), JSON.stringify(invalid, null, 2));
console.log(`Wrote sample files to ${outDir}`);
