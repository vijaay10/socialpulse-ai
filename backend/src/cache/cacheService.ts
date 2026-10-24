import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { logger } from "../logger.js";
import { buildCacheKey, normalizeParams, type CacheParams } from "./keys.js";

export type RedisClient = ReturnType<typeof createClient>;
export type CacheStatus = "hit" | "miss" | "bypass";

export interface CacheMeta {
  status: CacheStatus;
  key: string;
  namespace: string;
  ttlSeconds: number;
  /** Time spent talking to Redis for the lookup. */
  lookupMs: number;
  /** Total time to produce the response data (lookup + MongoDB on a miss). */
  totalMs: number;
  /** True when this request waited for another request that was already computing the value. */
  coalesced?: boolean;
  reason?: string;
}

export interface CacheResult<T> {
  data: T;
  cache: CacheMeta;
}

export interface CacheServiceOptions {
  prefix: string;
  commandTimeoutMs: number;
  lockTtlMs?: number;
  lockWaitMs?: number;
}

const SAMPLE_LIMIT = 1000;
const TIMELINE_TTL_SECONDS = 3 * 60 * 60;

class LatencySamples {
  private values: number[] = [];
  add(ms: number) {
    this.values.push(ms);
    if (this.values.length > SAMPLE_LIMIT) this.values.shift();
  }
  summary() {
    const sorted = [...this.values].sort((a, b) => a - b);
    const n = sorted.length;
    if (!n) return { count: 0, avgMs: null, p50Ms: null, p95Ms: null, maxMs: null };
    const pick = (p: number) => sorted[Math.min(n - 1, Math.ceil((p / 100) * n) - 1)];
    return {
      count: n,
      avgMs: round(sorted.reduce((a, b) => a + b, 0) / n),
      p50Ms: round(pick(50)),
      p95Ms: round(pick(95)),
      maxMs: round(sorted[n - 1]),
    };
  }
  reset() {
    this.values = [];
  }
}

/**
 * Cache-aside layer over Redis. MongoDB stays the source of truth: every
 * failure path here falls back to the loader (MongoDB) instead of erroring.
 */
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly hitLatency = new LatencySamples();
  private readonly missLatency = new LatencySamples();
  private readonly lookupLatency = new LatencySamples();
  private bypassCount = 0;
  private errorCount = 0;
  private lastError: { message: string; at: string } | null = null;
  private readonly lockTtlMs: number;
  private readonly lockWaitMs: number;

  constructor(
    private readonly client: RedisClient | null,
    private readonly opts: CacheServiceOptions,
  ) {
    this.lockTtlMs = opts.lockTtlMs ?? 10_000;
    this.lockWaitMs = opts.lockWaitMs ?? 3_000;
  }

  /** Create a client and start connecting without blocking startup if Redis is down. */
  static async connect(url: string, opts: CacheServiceOptions, waitMs = 3000): Promise<CacheService> {
    let lastLogged = 0;
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries: number) => Math.min(250 * 2 ** Math.min(retries, 5), 5000),
      },
    });
    const service = new CacheService(client, opts);
    client.on("error", (err: Error) => {
      service.recordError(err);
      if (Date.now() - lastLogged > 10_000) {
        lastLogged = Date.now();
        logger.warn({ err: err.message }, "Redis error (cache will be bypassed while unavailable)");
      }
    });
    client.on("ready", () => logger.info("Redis connected"));
    const connecting = client.connect().catch((err: Error) => service.recordError(err));
    await Promise.race([connecting, sleep(waitMs)]);
    if (!client.isReady) logger.warn("Redis not reachable at startup; continuing without cache");
    return service;
  }

  /** A second cache view on the same Redis connection under a different key prefix. */
  withPrefix(prefix: string): CacheService {
    return new CacheService(this.client, { ...this.opts, prefix });
  }

  get prefix() {
    return this.opts.prefix;
  }

  get isReady(): boolean {
    return Boolean(this.client?.isReady);
  }

  key(namespace: string, params: CacheParams): string {
    return buildCacheKey(this.opts.prefix, namespace, params);
  }

  async getOrSet<T>(namespace: string, params: CacheParams, ttlSeconds: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const key = this.key(namespace, params);
    const started = performance.now();
    const meta = (status: CacheStatus, lookupMs: number, extra: Partial<CacheMeta> = {}): CacheMeta => ({
      status,
      key,
      namespace,
      ttlSeconds,
      lookupMs: round(lookupMs),
      totalMs: round(performance.now() - started),
      ...extra,
    });

    if (!this.client || !this.client.isReady) {
      this.bypassCount++;
      const data = await loader();
      return { data, cache: meta("bypass", 0, { reason: "redis_unavailable" }) };
    }

    // 1-4: look up Redis and return on a hit.
    let lookupMs = 0;
    try {
      const t0 = performance.now();
      const raw = await this.withTimeout(this.client.get(key));
      lookupMs = performance.now() - t0;
      this.lookupLatency.add(lookupMs);
      if (raw !== null) {
        const data = JSON.parse(raw) as T;
        const m = meta("hit", lookupMs);
        this.hitLatency.add(m.totalMs);
        this.recordOutcome(namespace, "hit");
        return { data, cache: m };
      }
    } catch (err) {
      this.recordError(err as Error);
      this.bypassCount++;
      const data = await loader();
      return { data, cache: meta("bypass", lookupMs, { reason: "redis_error" }) };
    }

    // 5-7: miss. Coalesce concurrent identical requests in this process.
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      const data = await existing;
      const m = meta("miss", lookupMs, { coalesced: true });
      this.recordOutcome(namespace, "miss");
      return { data, cache: m };
    }
    const work = this.computeWithLock(key, ttlSeconds, loader);
    this.inflight.set(key, work);
    try {
      const data = await work;
      const m = meta("miss", lookupMs);
      this.missLatency.add(m.totalMs);
      this.recordOutcome(namespace, "miss");
      return { data, cache: m };
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Cross-process stampede protection: only the request holding the lock runs
   * the MongoDB query; others briefly wait for the value to appear in Redis.
   */
  private async computeWithLock<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    let haveLock = false;
    try {
      haveLock = (await this.withTimeout(this.client!.set(lockKey, token, { NX: true, PX: this.lockTtlMs }))) === "OK";
    } catch (err) {
      this.recordError(err as Error);
    }
    if (!haveLock) {
      const deadline = Date.now() + this.lockWaitMs;
      while (Date.now() < deadline) {
        await sleep(50);
        try {
          const raw = await this.withTimeout(this.client!.get(key));
          if (raw !== null) return JSON.parse(raw) as T;
        } catch {
          break;
        }
      }
    }
    try {
      const data = await loader();
      await this.set(key, data, ttlSeconds);
      return data;
    } finally {
      if (haveLock) {
        await this.withTimeout(
          this.client!.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", {
            keys: [lockKey],
            arguments: [token],
          }),
        ).catch(() => undefined);
      }
    }
  }

  private async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client?.isReady) return;
    try {
      await this.withTimeout(this.client.set(key, JSON.stringify(value), { EX: ttlSeconds }));
    } catch (err) {
      this.recordError(err as Error);
    }
  }

  /** Delete cached entries whose namespace starts with one of the given prefixes (all when empty). */
  async invalidate(namespaces: string[] = [], reason = "manual"): Promise<{ deleted: number; patterns: string[] }> {
    const patterns = (namespaces.length ? namespaces : [""]).map((ns) => `${this.opts.prefix}:cache:v1:${ns}*`);
    if (!this.client?.isReady) return { deleted: 0, patterns };
    let deleted = 0;
    try {
      for (const pattern of patterns) {
        for await (const batch of this.client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
          const keys = (Array.isArray(batch) ? batch : [batch]).filter((k: string) => !k.endsWith(":lock"));
          if (keys.length) deleted += await this.client.unlink(keys);
        }
      }
      const event = JSON.stringify({ at: new Date().toISOString(), reason, deleted, patterns });
      await this.client
        .multi()
        .hIncrBy(this.statKey("totals"), "invalidations", 1)
        .hIncrBy(this.statKey("totals"), "invalidated_keys", deleted)
        .lPush(this.statKey("invalidations"), event)
        .lTrim(this.statKey("invalidations"), 0, 19)
        .exec();
    } catch (err) {
      this.recordError(err as Error);
    }
    return { deleted, patterns };
  }

  private statKey(name: string) {
    return `${this.opts.prefix}:stats:${name}`;
  }

  private recordOutcome(namespace: string, outcome: "hit" | "miss") {
    if (!this.client?.isReady) return;
    const minute = Math.floor(Date.now() / 60_000) * 60;
    const tsKey = this.statKey(`ts:${minute}`);
    this.client
      .multi()
      .hIncrBy(this.statKey(outcome === "hit" ? "hits" : "misses"), namespace, 1)
      .hIncrBy(tsKey, outcome, 1)
      .expire(tsKey, TIMELINE_TTL_SECONDS)
      .exec()
      .catch((err: Error) => this.recordError(err));
  }

  private recordError(err: Error) {
    this.errorCount++;
    this.lastError = { message: err.message, at: new Date().toISOString() };
  }

  async health(): Promise<{ status: "up" | "down"; latencyMs?: number; error?: string }> {
    if (!this.client?.isReady) return { status: "down", error: this.lastError?.message ?? "not connected" };
    const t0 = performance.now();
    try {
      await this.withTimeout(this.client.ping());
      return { status: "up", latencyMs: round(performance.now() - t0) };
    } catch (err) {
      return { status: "down", error: (err as Error).message };
    }
  }

  async stats() {
    const health = await this.health();
    const local = {
      bypasses: this.bypassCount,
      errors: this.errorCount,
      lastError: this.lastError,
      latency: {
        hit: this.hitLatency.summary(),
        miss: this.missLatency.summary(),
        redisLookup: this.lookupLatency.summary(),
      },
    };
    if (health.status !== "up" || !this.client) {
      return { redis: health, prefix: this.opts.prefix, totals: null, namespaces: [], timeline: [], invalidations: [], server: null, local };
    }
    const c = this.client;
    const nowMinute = Math.floor(Date.now() / 60_000) * 60;
    const minutes = Array.from({ length: 30 }, (_, i) => nowMinute - (29 - i) * 60);
    const [hits, misses, totals, invalidations, ...timelineRaw] = await Promise.all([
      c.hGetAll(this.statKey("hits")),
      c.hGetAll(this.statKey("misses")),
      c.hGetAll(this.statKey("totals")),
      c.lRange(this.statKey("invalidations"), 0, 19),
      ...minutes.map((m) => c.hGetAll(this.statKey(`ts:${m}`))),
    ]);
    const namespaces = [...new Set([...Object.keys(hits), ...Object.keys(misses)])].sort().map((ns) => {
      const h = Number(hits[ns] ?? 0);
      const m = Number(misses[ns] ?? 0);
      return { namespace: ns, hits: h, misses: m, hitRatio: h + m ? round(h / (h + m), 4) : null };
    });
    const totalHits = namespaces.reduce((a, n) => a + n.hits, 0);
    const totalMisses = namespaces.reduce((a, n) => a + n.misses, 0);
    let cachedKeys = 0;
    for await (const batch of c.scanIterator({ MATCH: `${this.opts.prefix}:cache:v1:*`, COUNT: 1000 })) {
      cachedKeys += (Array.isArray(batch) ? batch : [batch]).filter((k: string) => !k.endsWith(":lock")).length;
    }
    const info = parseInfo(await c.info());
    return {
      redis: health,
      prefix: this.opts.prefix,
      totals: {
        hits: totalHits,
        misses: totalMisses,
        requests: totalHits + totalMisses,
        hitRatio: totalHits + totalMisses ? round(totalHits / (totalHits + totalMisses), 4) : null,
        cachedKeys,
        invalidations: Number(totals.invalidations ?? 0),
        invalidatedKeys: Number(totals.invalidated_keys ?? 0),
      },
      namespaces,
      timeline: minutes.map((m, i) => ({
        minute: new Date(m * 1000).toISOString(),
        hits: Number(timelineRaw[i].hit ?? 0),
        misses: Number(timelineRaw[i].miss ?? 0),
      })),
      invalidations: invalidations.map((s: string) => JSON.parse(s)),
      server: {
        version: info.redis_version,
        uptimeSeconds: Number(info.uptime_in_seconds),
        usedMemory: info.used_memory_human,
        maxMemory: info.maxmemory_human,
        evictionPolicy: info.maxmemory_policy,
        connectedClients: Number(info.connected_clients),
        keyspaceHits: Number(info.keyspace_hits),
        keyspaceMisses: Number(info.keyspace_misses),
        evictedKeys: Number(info.evicted_keys),
        totalKeys: info.db0 ? Number(/keys=(\d+)/.exec(info.db0)?.[1] ?? 0) : 0,
      },
      local,
    };
  }

  /** Clear hit/miss counters (used by tests and benchmarks). */
  async resetStats(): Promise<void> {
    this.hitLatency.reset();
    this.missLatency.reset();
    this.lookupLatency.reset();
    this.bypassCount = 0;
    if (!this.client?.isReady) return;
    for await (const batch of this.client.scanIterator({ MATCH: `${this.opts.prefix}:stats:*`, COUNT: 500 })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      if (keys.length) await this.client.unlink(keys);
    }
  }

  describeKey(namespace: string, params: CacheParams) {
    return { key: this.key(namespace, params), normalized: normalizeParams(params) };
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) await this.client.close().catch(() => this.client?.destroy());
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis command timed out after ${this.opts.commandTimeoutMs}ms`)), this.opts.commandTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }
}

function parseInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0 && !line.startsWith("#")) out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
