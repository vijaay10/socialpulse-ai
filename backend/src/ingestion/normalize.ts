import { z } from "zod";
import { MEDIA_TYPES, PLATFORMS, type Platform } from "../models/constants.js";
import { deriveTopics } from "./topics.js";

export interface NormalizedComment {
  comment_id: string;
  user: { user_id: string; handle: string };
  text: string;
  created_at: Date;
}

export interface NormalizedPost {
  post_id: string;
  platform: Platform;
  user: { user_id: string; handle: string; followers: number; verified: boolean };
  text: string;
  hashtags: string[];
  topics: string[];
  language: string;
  created_at: Date;
  engagement: { likes: number; shares: number; comments: number; reach: number };
  engagement_rate: number;
  interactions: number;
  media?: { type: (typeof MEDIA_TYPES)[number]; url?: string; width?: number; height?: number; duration_s?: number }[];
  engagement_history?: { at: Date; likes: number; shares: number; comments: number; reach: number }[];
  replies: NormalizedComment[];
  extra?: Record<string, unknown>;
}

export type NormalizeResult = { ok: true; post: NormalizedPost } | { ok: false; reason: string; post_id?: string };

const PLATFORM_ALIASES: Record<string, Platform> = {
  x: "twitter", tw: "twitter", tweet: "twitter", twitter: "twitter",
  ig: "instagram", insta: "instagram", instagram: "instagram",
  fb: "facebook", facebook: "facebook",
  reddit: "reddit", yt: "youtube", youtube: "youtube",
  linkedin: "linkedin", li: "linkedin",
};

const HASHTAG_IN_TEXT = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]{1,100})/gu;

/** Lower-case, strip '#', keep letters/digits/underscore, 1..100 chars. */
export function normalizeHashtag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().replace(/^#+/, "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
  return tag.length >= 1 && tag.length <= 100 ? tag : null;
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG_IN_TEXT)].map((m) => m[1]);
}

export function normalizeHashtags(fromField: unknown, text: string): string[] {
  let list: unknown[] = [];
  if (Array.isArray(fromField)) list = fromField;
  else if (typeof fromField === "string" && fromField.trim()) list = fromField.split(/[\s,;|]+/);
  const out = new Set<string>();
  for (const raw of [...list, ...extractHashtags(text)]) {
    const tag = normalizeHashtag(raw);
    if (tag) out.add(tag);
  }
  return [...out].slice(0, 30);
}

/** Engagement rate (%) = (likes + shares + comments) / reach x 100; 0 when reach is 0. */
export function engagementRate(e: { likes: number; shares: number; comments: number; reach: number }): number {
  if (!e.reach) return 0;
  return Math.round(((e.likes + e.shares + e.comments) / e.reach) * 100 * 10000) / 10000;
}

const count = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
  z.number({ invalid_type_error: "must be a number" }).finite().nonnegative("must be >= 0").transform(Math.round));

const bool = z.preprocess((v) => (typeof v === "string" ? ["true", "1", "yes", "y"].includes(v.trim().toLowerCase()) : Boolean(v)), z.boolean());

const dateField = z.preprocess((v) => {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string" && /^\d{10,13}$/.test(v.trim())) return new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v));
  if (typeof v === "string") return new Date(v);
  return v;
}, z.date({ invalid_type_error: "must be a valid date", required_error: "is required" }).refine((d) => !Number.isNaN(d.getTime()), "must be a valid date"));

const KNOWN_FIELDS = new Set([
  "post_id", "id", "platform", "source_platform", "text", "content", "message", "body", "hashtags", "tags", "topics",
  "created_at", "timestamp", "date", "posted_at", "user", "author", "user_id", "author_id", "handle", "username", "followers",
  "follower_count", "verified", "likes", "like_count", "shares", "retweets", "share_count", "comments", "comment_count",
  "replies_count", "reach", "impressions", "views", "engagement", "language", "lang", "media", "media_type", "media_url",
  "replies", "engagement_history", "schema_version", "sentiment",
]);

const pick = (r: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  return undefined;
};

const coreSchema = z.object({
  post_id: z.string().trim().min(1, "is required").max(200),
  platform: z.enum(PLATFORMS, { errorMap: () => ({ message: `must be one of ${PLATFORMS.join(", ")}` }) }),
  text: z.string().trim().min(1, "is required").max(5000, "exceeds 5000 characters"),
  created_at: dateField,
  user_id: z.string().trim().min(1, "is required").max(200),
  handle: z.string().trim().min(1).max(200),
  followers: count,
  verified: bool,
  likes: count,
  shares: count,
  comments: count,
  reach: count,
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, "must be an ISO language code").default("en"),
});

export function normalizeRecord(input: unknown, now = new Date()): NormalizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "record must be an object" };
  const r = input as Record<string, unknown>;
  const user = (typeof r.user === "object" && r.user ? r.user : typeof r.author === "object" && r.author ? r.author : {}) as Record<string, unknown>;
  const eng = (typeof r.engagement === "object" && r.engagement ? r.engagement : {}) as Record<string, unknown>;
  const rawPlatform = pick(r, "platform", "source_platform");
  const platform = typeof rawPlatform === "string" ? PLATFORM_ALIASES[rawPlatform.trim().toLowerCase()] ?? rawPlatform.trim().toLowerCase() : rawPlatform;
  const rawId = pick(r, "post_id", "id");
  const userId = pick(user, "user_id", "id") ?? pick(r, "user_id", "author_id");
  const handleRaw = pick(user, "handle", "username") ?? pick(r, "handle", "username") ?? userId;

  const parsed = coreSchema.safeParse({
    post_id: rawId === undefined ? undefined : String(rawId),
    platform,
    text: pick(r, "text", "content", "message", "body"),
    created_at: pick(r, "created_at", "timestamp", "date", "posted_at"),
    user_id: userId === undefined ? undefined : String(userId),
    handle: handleRaw === undefined ? undefined : String(handleRaw),
    followers: pick(user, "followers", "follower_count") ?? pick(r, "followers", "follower_count"),
    verified: pick(user, "verified") ?? pick(r, "verified") ?? false,
    likes: pick(eng, "likes") ?? pick(r, "likes", "like_count"),
    shares: pick(eng, "shares", "retweets") ?? pick(r, "shares", "retweets", "share_count"),
    comments: pick(eng, "comments") ?? pick(r, "comment_count", "replies_count", ...(typeof r.comments === "object" ? [] : ["comments"])),
    reach: pick(eng, "reach", "impressions", "views") ?? pick(r, "reach", "impressions", "views"),
    language: pick(r, "language", "lang"),
  });
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
    return { ok: false, reason, post_id: rawId === undefined ? undefined : String(rawId) };
  }
  const p = parsed.data;
  if (p.created_at.getTime() > now.getTime() + 24 * 3600 * 1000) {
    return { ok: false, reason: "created_at is more than 24h in the future", post_id: p.post_id };
  }
  const engagement = { likes: p.likes, shares: p.shares, comments: p.comments, reach: Math.max(p.reach, 0) };
  const hashtags = normalizeHashtags(pick(r, "hashtags", "tags"), p.text);
  const providedTopics = Array.isArray(r.topics)
    ? r.topics.map((t) => normalizeHashtag(t)).filter((t): t is string => Boolean(t))
    : typeof r.topics === "string" ? r.topics.split(/[\s,;|]+/).map(normalizeHashtag).filter((t): t is string => Boolean(t)) : [];
  const topics = [...new Set([...providedTopics, ...deriveTopics(hashtags, p.text)])].sort();

  const handle = p.handle.startsWith("@") ? p.handle : `@${p.handle}`;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!KNOWN_FIELDS.has(k)) extra[k] = v;

  return {
    ok: true,
    post: {
      post_id: p.post_id,
      platform: p.platform,
      user: { user_id: p.user_id, handle, followers: p.followers, verified: p.verified },
      text: p.text,
      hashtags,
      topics,
      language: p.language,
      created_at: p.created_at,
      engagement,
      engagement_rate: engagementRate(engagement),
      interactions: engagement.likes + engagement.shares + engagement.comments,
      media: normalizeMedia(r),
      engagement_history: normalizeHistory(r.engagement_history),
      replies: normalizeReplies(r.replies ?? (Array.isArray(r.comments) ? r.comments : undefined), p.created_at),
      extra: Object.keys(extra).length ? extra : undefined,
    },
  };
}

function normalizeMedia(r: Record<string, unknown>): NormalizedPost["media"] {
  const list: unknown[] = Array.isArray(r.media) ? r.media : r.media_type ? [{ type: r.media_type, url: r.media_url }] : [];
  const out: NonNullable<NormalizedPost["media"]> = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const item = m as Record<string, unknown>;
    const type = String(item.type ?? "").toLowerCase();
    if (!(MEDIA_TYPES as readonly string[]).includes(type)) continue;
    const num = (v: unknown) => (typeof v === "number" && v >= 0 ? v : typeof v === "string" && v.trim() && Number(v) >= 0 ? Number(v) : undefined);
    out.push({
      type: type as (typeof MEDIA_TYPES)[number],
      url: typeof item.url === "string" && item.url ? item.url : undefined,
      width: num(item.width),
      height: num(item.height),
      duration_s: num(item.duration_s),
    });
  }
  return out.length ? out.slice(0, 20) : undefined;
}

function normalizeHistory(raw: unknown): NormalizedPost["engagement_history"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<NormalizedPost["engagement_history"]> = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const item = h as Record<string, unknown>;
    const at = new Date(item.at as string);
    if (Number.isNaN(at.getTime())) continue;
    const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    out.push({ at, likes: n(item.likes), shares: n(item.shares), comments: n(item.comments), reach: n(item.reach) });
  }
  return out.length ? out : undefined;
}

function normalizeReplies(raw: unknown, postCreated: Date): NormalizedComment[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedComment[] = [];
  for (const c of raw.slice(0, 200)) {
    if (!c || typeof c !== "object") continue;
    const item = c as Record<string, unknown>;
    const id = item.comment_id ?? item.id;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (id === undefined || !text) continue;
    const u = (typeof item.user === "object" && item.user ? item.user : {}) as Record<string, unknown>;
    const userId = String(u.user_id ?? item.user_id ?? "unknown");
    const created = item.created_at ? new Date(item.created_at as string) : postCreated;
    out.push({
      comment_id: String(id),
      user: { user_id: userId, handle: String(u.handle ?? item.handle ?? `@${userId}`) },
      text: text.slice(0, 5000),
      created_at: Number.isNaN(created.getTime()) ? postCreated : created,
    });
  }
  return out;
}
