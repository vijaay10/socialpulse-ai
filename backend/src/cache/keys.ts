import { createHash } from "node:crypto";

export type CacheParams = Record<string, unknown>;

/**
 * Canonical form of request parameters: keys sorted, empty values dropped,
 * arrays de-duplicated and sorted, dates as ISO strings. Two requests that
 * mean the same thing produce the same string (and therefore the same key).
 */
export function normalizeParams(params: CacheParams): string {
  return JSON.stringify(canonical(params) ?? {});
}

function canonical(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.map(canonical).filter((v) => v !== undefined);
    if (items.length === 0) return undefined;
    return [...new Set(items.map((v) => JSON.stringify(v)))].sort().map((s) => JSON.parse(s));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = canonical((value as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

export function hashParams(params: CacheParams): string {
  return createHash("sha1").update(normalizeParams(params)).digest("hex").slice(0, 20);
}

/** Key layout: <prefix>:cache:v1:<namespace>:<sha1(normalized params)> */
export function buildCacheKey(prefix: string, namespace: string, params: CacheParams): string {
  return `${prefix}:cache:v1:${namespace}:${hashParams(params)}`;
}
