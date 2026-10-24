import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CachePage } from "../pages/Cache";
import { DataPage } from "../pages/Data";
import { OverviewPage } from "../pages/Overview";
import { cacheMeta, mockFetch, renderWithProviders } from "./utils";

const range = { from: "2026-09-23T00:00:00Z", to: "2026-10-23T00:00:00Z", window: "30d", anchor: "latest_post" };
const overview = (posts: number) => ({
  range,
  totals: { posts, uniqueUsers: 12, uniqueHashtags: 9, storedComments: 4, likes: 100, shares: 10, comments: 5, reach: 2000, interactions: 115, avgEngagementRate: 5.1, aggregateEngagementRate: 5.75, avgSentiment: 0.12, syntheticPosts: posts },
  previousPeriod: { postsChangePct: 25, interactionsChangePct: -10, avgSentiment: 0.1 },
  sentiment: { distribution: { positive: 20, neutral: 15, negative: 7 }, percentages: { positive: 47.6, neutral: 35.7, negative: 16.7 } },
  platforms: [{ platform: "twitter", posts, interactions: 115, reach: 2000, engagementRate: 5.75, avgSentiment: 0.12 }],
  topHashtags: [{ hashtag: "chennairains", count: 30 }],
  topTopics: [{ topic: "environment", count: 30 }],
});

afterEach(() => vi.unstubAllGlobals());

describe("OverviewPage", () => {
  it("renders metrics, hashtags and cache status from the API", async () => {
    const fetch = mockFetch((url) => {
      if (url.pathname === "/api/analytics/overview") return { body: { data: overview(42), meta: { cache: cacheMeta("hit") } } };
      if (url.pathname === "/api/analytics/trends/rising") return { body: { data: { range, previousRange: range, minCount: 3, growthFormula: "", rising: [], falling: [] }, meta: { cache: cacheMeta("miss") } } };
      if (url.pathname === "/api/analytics/sentiment") return { body: { data: { range, interval: "day", overTime: [] }, meta: { cache: cacheMeta("miss") } } };
      if (url.pathname === "/api/analytics/engagement") return { body: { data: { range, interval: "day", overTime: [] }, meta: { cache: cacheMeta("miss") } } };
    });
    renderWithProviders(<OverviewPage />, "/?window=30d&platform=twitter");
    expect(await screen.findByText("#chennairains")).toBeInTheDocument();
    expect(screen.getByText("Posts").nextSibling).toHaveTextContent("42");
    expect(screen.getByText("5.75%")).toBeInTheDocument();
    expect(screen.getAllByText("Redis HIT").length).toBeGreaterThan(0);
    expect(screen.getByText(/SYNTHETIC sample data/)).toBeInTheDocument();
    expect(screen.getByText("No rising hashtags for these filters.")).toBeInTheDocument();
    const overviewCall = fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/api/analytics/overview"))!;
    expect(overviewCall).toContain("window=30d");
    expect(overviewCall).toContain("platform=twitter");
  });

  it("shows an empty state when there is no data", async () => {
    mockFetch((url) => (url.pathname === "/api/analytics/overview" ? { body: { data: overview(0), meta: { cache: cacheMeta("miss") } } } : undefined));
    renderWithProviders(<OverviewPage />);
    expect(await screen.findByText(/Load the sample dataset or upload a file/)).toBeInTheDocument();
  });

  it("shows an error state when the API fails", async () => {
    mockFetch(() => ({ status: 500, body: { error: "InternalServerError", message: "An unexpected error occurred" } }));
    renderWithProviders(<OverviewPage />);
    expect((await screen.findAllByText("An unexpected error occurred")).length).toBeGreaterThan(0);
  });
});

describe("DataPage", () => {
  it("requires the admin key before importing and sends it as X-API-Key", async () => {
    sessionStorage.clear();
    const fetch = mockFetch((url, init) => {
      if (url.pathname === "/api/ingestion/batches") return { body: { data: [] } };
      if (url.pathname === "/api/ingestion/seed" && init?.method === "POST")
        return { status: 201, body: { data: { batchId: "seed_1", received: 10, processed: 10, imported: 10, skipped: 0, failed: 0, commentsImported: 3, sentiment: { positive: 5, neutral: 3, negative: 2 }, errors: [], errorsTruncated: false, cache: { invalidatedKeys: 2 }, trendsMaterialized: 40, durationMs: 120 } } };
    });
    const user = userEvent.setup();
    renderWithProviders(<DataPage />);
    const seedBtn = screen.getByRole("button", { name: /Generate & ingest/ });
    expect(seedBtn).toBeDisabled();
    await user.type(screen.getByLabelText("Admin API key"), "secret-key-123");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(seedBtn).toBeEnabled();
    await user.click(seedBtn);
    const report = await screen.findByRole("status");
    expect(within(report).getByText(/Batch seed_1 finished/)).toBeInTheDocument();
    expect(within(report).getByText(/2 Redis keys invalidated/)).toBeInTheDocument();
    const seedCall = fetch.mock.calls.find((c) => String(c[0]).includes("/api/ingestion/seed"))!;
    expect((seedCall[1] as RequestInit).headers).toMatchObject({ "X-API-Key": "secret-key-123" });
  });
});

describe("CachePage", () => {
  it("warns when Redis is down and MongoDB is serving requests", async () => {
    mockFetch((url) => {
      if (url.pathname === "/api/cache/stats")
        return { body: { data: { redis: { status: "down", error: "connect ECONNREFUSED" }, prefix: "sp", totals: null, namespaces: [], timeline: [], invalidations: [], server: null, local: { bypasses: 7, errors: 3, lastError: null, latency: { hit: {}, miss: {}, redisLookup: {} } }, ttlSeconds: { overview: 60 } } } };
      if (url.pathname === "/api/benchmark/results") return { body: { data: [] } };
    });
    renderWithProviders(<CachePage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Redis is unavailable (connect ECONNREFUSED)"));
    expect(screen.getByRole("alert")).toHaveTextContent("Bypassed requests so far: 7");
  });
});
