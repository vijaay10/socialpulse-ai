import { describe, expect, it } from "vitest";
import { normalizeRecord } from "../../src/ingestion/normalize.js";
import { generateSyntheticPosts } from "../../src/ingestion/synthetic.js";

describe("synthetic generator", () => {
  const end = new Date("2026-10-20T12:00:00Z");
  it("is deterministic for a given seed", () => {
    expect(generateSyntheticPosts({ count: 50, seed: 1, end })).toEqual(generateSyntheticPosts({ count: 50, seed: 1, end }));
    expect(generateSyntheticPosts({ count: 50, seed: 1, end })).not.toEqual(generateSyntheticPosts({ count: 50, seed: 2, end }));
  });

  it("produces valid, clearly synthetic records inside the window", () => {
    const posts = generateSyntheticPosts({ count: 300, seed: 3, end, days: 10 });
    for (const p of posts) {
      expect(p.synthetic).toBe(true);
      expect(String(p.post_id)).toMatch(/^syn3_/);
      const r = normalizeRecord(p, end);
      expect(r.ok).toBe(true);
      const t = new Date(p.created_at as string).getTime();
      expect(t).toBeLessThanOrEqual(end.getTime());
      expect(t).toBeGreaterThanOrEqual(end.getTime() - 10 * 86400000);
    }
    expect(new Set(posts.map((p) => p.platform)).size).toBeGreaterThanOrEqual(5);
  });
});
