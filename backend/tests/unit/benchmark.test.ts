import { describe, expect, it } from "vitest";
import { summarize } from "../../src/benchmark/runner.js";

describe("benchmark statistics", () => {
  it("computes avg, median and p95 with interpolation", () => {
    const s = summarize([5, 1, 3, 2, 4]);
    expect(s).toMatchObject({ runs: 5, avgMs: 3, medianMs: 3, minMs: 1, maxMs: 5 });
    expect(s.p95Ms).toBeCloseTo(4.8);
  });
});
