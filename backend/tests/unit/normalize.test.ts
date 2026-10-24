import { describe, expect, it } from "vitest";
import { engagementRate, normalizeHashtag, normalizeHashtags, normalizeRecord } from "../../src/ingestion/normalize.js";
import { deriveTopics } from "../../src/ingestion/topics.js";

const base = { post_id: "p1", platform: "twitter", text: "Loving #CampusFest in #Chennai", created_at: "2026-10-01T10:00:00Z", user_id: "u1" };

describe("hashtag normalisation", () => {
  it("lower-cases, strips # and punctuation", () => {
    expect(normalizeHashtag("#CampusFest!")).toBe("campusfest");
    expect(normalizeHashtag("##AI")).toBe("ai");
    expect(normalizeHashtag("   ")).toBeNull();
    expect(normalizeHashtag(42)).toBeNull();
  });
  it("merges field hashtags with hashtags found in text, de-duplicated", () => {
    expect(normalizeHashtags("Music, #campusfest", "Great day #CampusFest #Chennai")).toEqual(["music", "campusfest", "chennai"]);
    expect(normalizeHashtags(["#AI", "ai"], "")).toEqual(["ai"]);
  });
});

describe("engagement rate", () => {
  it("is (likes + shares + comments) / reach x 100", () => {
    expect(engagementRate({ likes: 40, shares: 5, comments: 5, reach: 1000 })).toBe(5);
    expect(engagementRate({ likes: 1, shares: 0, comments: 0, reach: 0 })).toBe(0);
  });
});

describe("normalizeRecord", () => {
  it("accepts flat records and derives fields", () => {
    const r = normalizeRecord({ ...base, likes: "1,200", shares: 10, comments: 5, reach: 20000, platform: "X", handle: "nova" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.post.platform).toBe("twitter");
    expect(r.post.hashtags).toEqual(["campusfest", "chennai"]);
    expect(r.post.engagement.likes).toBe(1200);
    expect(r.post.interactions).toBe(1215);
    expect(r.post.user.handle).toBe("@nova");
    expect(r.post.topics).toContain("education");
  });

  it("accepts nested proposal-style documents and keeps unknown fields in extra", () => {
    const r = normalizeRecord({
      post_id: "tw_1849302774", platform: "twitter", text: "The campus fest lineup looks incredible #CampusFest",
      user: { user_id: "u_88213", handle: "@nova_reviews", followers: 12840, verified: false },
      engagement: { likes: 412, shares: 87, comments: 36, reach: 15230 },
      media: [{ type: "image", url: "https://example.invalid/a.jpg", width: 1080 }],
      created_at: "2026-08-18T14:22:05Z", language: "en", location: "Chennai",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.post.engagement).toEqual({ likes: 412, shares: 87, comments: 36, reach: 15230 });
    expect(r.post.media?.[0].type).toBe("image");
    expect(r.post.extra).toEqual({ location: "Chennai" });
  });

  it.each([
    [{ ...base, platform: "myspace" }, /platform/],
    [{ ...base, text: "" }, /text/],
    [{ ...base, created_at: "yesterday-ish" }, /created_at/],
    [{ ...base, likes: -1 }, /likes/],
    [{ ...base, post_id: undefined }, /post_id/],
    [{ ...base, created_at: new Date(Date.now() + 5 * 86400000).toISOString() }, /future/],
    [{ ...base, language: "english!!" }, /language/],
  ])("rejects invalid record %#", (rec, reason) => {
    const r = normalizeRecord(rec);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it("rejects non-objects", () => {
    expect(normalizeRecord("x").ok).toBe(false);
    expect(normalizeRecord(null).ok).toBe(false);
    expect(normalizeRecord([1]).ok).toBe(false);
  });

  it("parses epoch timestamps", () => {
    const r = normalizeRecord({ ...base, created_at: 1759312800 });
    expect(r.ok && r.post.created_at.toISOString()).toBe("2025-10-01T10:00:00.000Z");
  });
});

describe("topics", () => {
  it("maps hashtags and words to topics", () => {
    expect(deriveTopics(["ipl2026"], "great biryani")).toEqual(["food", "sports"]);
  });
});
