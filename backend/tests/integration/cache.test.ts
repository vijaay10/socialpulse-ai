import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CacheService } from "../../src/cache/cacheService.js";

let cache: CacheService;
const prefix = `${process.env.REDIS_KEY_PREFIX}:unit`;

beforeAll(async () => {
  cache = await CacheService.connect(process.env.REDIS_URL!, { prefix, commandTimeoutMs: 500 });
  expect(cache.isReady).toBe(true);
});
afterAll(async () => {
  await cache.invalidate([]);
  await cache.resetStats();
  await cache.close();
});

describe("CacheService against a real Redis", () => {
  it("coalesces concurrent identical misses into one loader call (stampede protection)", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 100));
      return { value: 42 };
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrSet("stampede", { a: 1 }, 30, loader)));
    expect(calls).toBe(1);
    expect(results.every((r) => r.data.value === 42)).toBe(true);
    expect(results.filter((r) => r.cache.coalesced).length).toBe(19);
  });

  it("waits for another holder of the distributed lock instead of recomputing", async () => {
    const other = cache.withPrefix(prefix); // separate in-process state, same Redis keys
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
      return "v";
    };
    const [a, b] = await Promise.all([cache.getOrSet("lock", { k: 1 }, 30, slow), other.getOrSet("lock", { k: 1 }, 30, slow)]);
    expect(a.data).toBe("v");
    expect(b.data).toBe("v");
    expect(calls).toBe(1);
  });

  it("propagates loader errors and does not cache them", async () => {
    await expect(cache.getOrSet("err", {}, 30, async () => Promise.reject(new Error("mongo down")))).rejects.toThrow("mongo down");
    const ok = await cache.getOrSet("err", {}, 30, async () => "recovered");
    expect(ok.cache.status).toBe("miss");
    expect(ok.data).toBe("recovered");
  });

  it("expires entries after the TTL", async () => {
    await cache.getOrSet("ttl", {}, 1, async () => 1);
    expect((await cache.getOrSet("ttl", {}, 1, async () => 2)).cache.status).toBe("hit");
    await new Promise((r) => setTimeout(r, 1200));
    const r = await cache.getOrSet("ttl", {}, 1, async () => 3);
    expect(r.cache.status).toBe("miss");
    expect(r.data).toBe(3);
  });
});
