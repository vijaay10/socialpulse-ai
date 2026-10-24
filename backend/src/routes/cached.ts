import type { Response } from "express";
import type { CacheResult } from "../cache/cacheService.js";

/** Send a cached result: data plus cache metadata in the body and X-Cache headers. */
export function sendCached<T>(res: Response, result: CacheResult<T>) {
  res.setHeader("X-Cache", result.cache.status.toUpperCase());
  res.setHeader("X-Cache-Key", result.cache.key);
  res.setHeader("X-Response-Time-Ms", String(result.cache.totalMs));
  res.json({ data: result.data, meta: { cache: result.cache } });
}
