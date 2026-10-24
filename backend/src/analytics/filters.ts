import { z } from "zod";
import { PLATFORMS, SENTIMENT_LABELS } from "../models/constants.js";
import { Post } from "../models/Post.js";
import { normalizeHashtag } from "../ingestion/normalize.js";

export const WINDOWS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
export type WindowKey = keyof typeof WINDOWS | "all";
const DAY_MS = 86_400_000;

const csvList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const cleaned = arr.map((s) => String(s).trim()).filter(Boolean);
    return cleaned.length ? [...new Set(cleaned)].sort() : undefined;
  }, z.array(item).max(50).optional());

const isoDate = z
  .string()
  .trim()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date")
  .transform((s) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s));

export const filterSchema = z
  .object({
    window: z.enum(["24h", "7d", "30d", "90d", "all"]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    platform: csvList(z.enum(PLATFORMS)),
    hashtag: csvList(z.string().max(100)).transform((tags) => tags?.map((t) => normalizeHashtag(t)).filter((t): t is string => Boolean(t))),
    sentiment: csvList(z.enum(SENTIMENT_LABELS)),
    language: csvList(z.string().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/)),
    topic: csvList(z.string().max(100)),
  })
  .refine((f) => !(f.from && f.to) || f.from <= f.to, { message: "from must be before to", path: ["from"] });

export type Filters = z.infer<typeof filterSchema>;

export const intervalSchema = z.enum(["hour", "day", "week"]).optional();
export const limitSchema = (def: number, max = 100) => z.coerce.number().int().min(1).max(max).default(def);

export interface ResolvedRange {
  from: Date | null;
  to: Date;
  window: WindowKey | "custom";
  /** How `to` was chosen when not given explicitly. */
  anchor: "explicit" | "latest_post" | "now";
}

/**
 * Time windows are anchored at `to` when given, otherwise at the newest post
 * in the database (so an imported historical dataset still has a "last 7 days").
 */
export async function resolveRange(f: Filters, defaultWindow: WindowKey = "30d"): Promise<ResolvedRange> {
  let to = f.to;
  let anchor: ResolvedRange["anchor"] = "explicit";
  if (!to) {
    const latest = await Post.findOne({}, { created_at: 1 }).sort({ created_at: -1 }).lean();
    to = latest?.created_at ?? new Date();
    anchor = latest ? "latest_post" : "now";
  }
  if (f.from) return { from: f.from, to, window: "custom", anchor };
  const window = f.window ?? defaultWindow;
  if (window === "all") return { from: null, to, window, anchor };
  return { from: new Date(to.getTime() - WINDOWS[window] * DAY_MS), to, window, anchor };
}

export function previousRange(r: ResolvedRange): { from: Date; to: Date } | null {
  if (!r.from) return null;
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: r.from };
}

/** Build a $match stage from filters and a date range (inclusive of `to`). */
export function buildMatch(f: Filters, range: { from: Date | null; to: Date }, opts: { skipDate?: boolean } = {}): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (!opts.skipDate) {
    match.created_at = range.from ? { $gte: range.from, $lte: range.to } : { $lte: range.to };
  }
  if (f.platform?.length) match.platform = { $in: f.platform };
  if (f.hashtag?.length) match.hashtags = { $in: f.hashtag };
  if (f.sentiment?.length) match["sentiment.label"] = { $in: f.sentiment };
  if (f.language?.length) match.language = { $in: f.language };
  if (f.topic?.length) match.topics = { $in: f.topic };
  return match;
}

export function autoInterval(range: ResolvedRange, requested?: "hour" | "day" | "week"): "hour" | "day" | "week" {
  if (requested) return requested;
  const spanDays = range.from ? (range.to.getTime() - range.from.getTime()) / DAY_MS : 365;
  return spanDays <= 2 ? "hour" : spanDays <= 120 ? "day" : "week";
}

export const round = (n: number | null | undefined, digits = 4) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits);

export function describeRange(r: ResolvedRange) {
  return { from: r.from?.toISOString() ?? null, to: r.to.toISOString(), window: r.window, anchor: r.anchor };
}
