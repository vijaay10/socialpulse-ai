import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("config", () => {
  it("uses the documented default TTLs", () => {
    const c = loadConfig({ ADMIN_API_KEY: "x".repeat(16) });
    expect(c.cacheTtl).toEqual({ trends: 60, overview: 60, sentiment: 120, engagement: 120, posts: 30 });
  });
  it("rejects a missing admin key", () => {
    expect(() => loadConfig({})).toThrow(/ADMIN_API_KEY/);
  });
});
