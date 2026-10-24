import { describe, expect, it } from "vitest";
import { buildCacheKey, normalizeParams } from "../../src/cache/keys.js";

describe("cache keys", () => {
  it("is independent of parameter order, duplicates and empty values", () => {
    const a = buildCacheKey("sp", "analytics:overview", { window: "7d", platform: ["twitter", "instagram"], hashtag: undefined });
    const b = buildCacheKey("sp", "analytics:overview", { platform: ["instagram", "twitter", "twitter"], window: "7d", sentiment: "" });
    expect(a).toBe(b);
    expect(a).toMatch(/^sp:cache:v1:analytics:overview:[0-9a-f]{20}$/);
  });

  it("differs when filters differ", () => {
    const a = buildCacheKey("sp", "analytics:overview", { window: "7d" });
    const b = buildCacheKey("sp", "analytics:overview", { window: "30d" });
    const c = buildCacheKey("sp", "analytics:sentiment", { window: "7d" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("serialises dates as ISO strings", () => {
    const d = new Date("2026-10-01T00:00:00Z");
    expect(normalizeParams({ from: d })).toBe('{"from":"2026-10-01T00:00:00.000Z"}');
  });
});
