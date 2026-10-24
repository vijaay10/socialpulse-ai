import type { CacheMeta } from "../lib/api";
import { fmtMs } from "../lib/format";

const STYLE: Record<string, string> = {
  hit: "bg-[color-mix(in_srgb,var(--s3)_16%,transparent)] text-ink",
  miss: "bg-[color-mix(in_srgb,var(--s2)_16%,transparent)] text-ink",
  bypass: "bg-warn text-ink",
};
const DOT: Record<string, string> = { hit: "var(--s3)", miss: "var(--s2)", bypass: "var(--s4)" };

/** Shows whether a response came from Redis (HIT), MongoDB (MISS) or MongoDB with Redis down (BYPASS). */
export function CacheBadge({ cache, clientMs }: { cache?: CacheMeta; clientMs?: number }) {
  if (!cache) return null;
  const title = `Redis ${cache.status.toUpperCase()} · key ${cache.key} · TTL ${cache.ttlSeconds}s · server ${fmtMs(cache.totalMs)}${clientMs ? ` · round trip ${fmtMs(clientMs)}` : ""}${cache.reason ? ` · ${cache.reason}` : ""}`;
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular ${STYLE[cache.status]}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[cache.status] }} aria-hidden />
      {cache.status === "hit" ? "Redis HIT" : cache.status === "miss" ? "MISS → MongoDB" : "BYPASS (Redis down)"}
      <span className="text-ink-2">{fmtMs(cache.totalMs)}</span>
    </span>
  );
}
