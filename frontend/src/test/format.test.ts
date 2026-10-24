import { fmtMs, fmtNum, fmtPct, fmtScore } from "../lib/format";
import { toQuery } from "../lib/api";

describe("formatting", () => {
  it("formats numbers, percentages, scores and durations", () => {
    expect(fmtNum(1234)).toBe("1,234");
    expect(fmtNum(762900)).toBe("762.9K");
    expect(fmtNum(null)).toBe("–");
    expect(fmtPct(5.2835, 2)).toBe("5.28%");
    expect(fmtScore(0.15)).toBe("+0.150");
    expect(fmtScore(-0.2)).toBe("-0.200");
    expect(fmtMs(0.456)).toBe("0.46 ms");
    expect(fmtMs(45.12)).toBe("45.1 ms");
  });

  it("builds query strings without empty values", () => {
    expect(toQuery({ window: "7d", platform: undefined, hashtag: "", limit: 5 })).toBe("?window=7d&limit=5");
    expect(toQuery({})).toBe("");
  });
});
