const filterParams = [
  { name: "window", in: "query", schema: { type: "string", enum: ["24h", "7d", "30d", "90d", "all"] }, description: "Time window ending at `to` (default: newest post in the database)" },
  { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
  { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
  { name: "platform", in: "query", schema: { type: "string" }, description: "Comma-separated: twitter,instagram,facebook,reddit,youtube,linkedin" },
  { name: "hashtag", in: "query", schema: { type: "string" }, description: "Comma-separated hashtags (with or without #)" },
  { name: "sentiment", in: "query", schema: { type: "string" }, description: "Comma-separated: positive,neutral,negative" },
  { name: "language", in: "query", schema: { type: "string" }, description: "Comma-separated ISO codes, e.g. en,hi" },
  { name: "topic", in: "query", schema: { type: "string" } },
];
const q = (name: string, schema: Record<string, unknown>, description?: string) => ({ name, in: "query", schema, ...(description ? { description } : {}) });
const cached = (summary: string, params: unknown[] = []) => ({
  summary,
  parameters: [...filterParams, ...params],
  responses: {
    200: { description: "`{ data, meta: { cache } }`. Header `X-Cache` is HIT, MISS or BYPASS (Redis unavailable)." },
    400: { description: "Invalid parameters" },
  },
});
const admin = [{ apiKey: [] }];

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "SocialPulse AI API",
    version: "1.0.0",
    description: "Social-media trend analytics. MongoDB is the source of truth; Redis caches analytics responses (cache-aside).",
  },
  servers: [{ url: "/" }],
  components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } } },
  paths: {
    "/api/health": { get: { summary: "MongoDB, Redis and NLP service health", responses: { 200: { description: "ok or degraded" }, 503: { description: "MongoDB down" } } } },
    "/api/analytics/overview": { get: cached("Dashboard overview (totals, sentiment split, platforms, top hashtags, previous-period change)") },
    "/api/analytics/trends": {
      get: cached("Top hashtags/topics with previous-period comparison, per-platform rankings and time series", [
        q("kind", { type: "string", enum: ["hashtag", "topic"] }),
        q("limit", { type: "integer", default: 10, maximum: 50 }),
        q("interval", { type: "string", enum: ["hour", "day", "week"] }),
      ]),
    },
    "/api/analytics/trends/rising": {
      get: cached("Rising and falling hashtags/topics: current window vs previous window of equal length", [
        q("kind", { type: "string", enum: ["hashtag", "topic"] }),
        q("limit", { type: "integer", default: 10 }),
        q("minCount", { type: "integer", default: 3 }, "Minimum occurrences to qualify"),
      ]),
    },
    "/api/analytics/trends/materialized": {
      get: { summary: "Materialised rankings from the trends collection", parameters: [q("kind", { type: "string" }), q("window", { type: "string", enum: ["24h", "7d", "30d", "90d"] }), q("platform", { type: "string" })], responses: { 200: { description: "ok" } } },
    },
    "/api/analytics/sentiment": { get: cached("Sentiment distribution, over time, by platform/hashtag/topic/language, and engagement by sentiment", [q("interval", { type: "string", enum: ["hour", "day", "week"] }), q("hashtagLimit", { type: "integer" })]) },
    "/api/analytics/engagement": { get: cached("Engagement totals, rate, over time, by platform/media/sentiment, top posts and correlations", [q("interval", { type: "string", enum: ["hour", "day", "week"] }), q("topLimit", { type: "integer" })]) },
    "/api/posts": {
      get: cached("Paginated, searchable posts", [
        q("q", { type: "string" }, "Full-text search (MongoDB text index)"),
        q("page", { type: "integer", default: 1 }),
        q("limit", { type: "integer", default: 20, maximum: 100 }),
        q("sort", { type: "string", enum: ["recent", "oldest", "engagement", "rate", "sentiment"] }),
      ]),
    },
    "/api/posts/{id}": {
      get: { summary: "Post with comments, sentiment history, engagement snapshots and author", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "MongoDB _id or post_id" }], responses: { 200: { description: "ok" }, 404: { description: "not found" } } },
    },
    "/api/ingestion/upload": {
      post: {
        summary: "Upload CSV / JSON / NDJSON posts",
        security: admin,
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } },
        responses: { 201: { description: "Ingestion report (imported/skipped/failed/processed)" }, 400: { description: "Invalid file" }, 401: { description: "Missing API key" }, 413: { description: "Too large" }, 415: { description: "Unsupported type" } },
      },
    },
    "/api/ingestion/seed": {
      post: {
        summary: "Generate and ingest a SYNTHETIC dataset",
        security: admin,
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer", default: 2000 }, seed: { type: "integer", default: 42 }, days: { type: "integer", default: 30 }, reset: { type: "boolean", default: false } } } } } },
        responses: { 201: { description: "Ingestion report" }, 401: { description: "Missing API key" } },
      },
    },
    "/api/ingestion/batches": { get: { summary: "Recent ingestion batches", responses: { 200: { description: "ok" } } } },
    "/api/ingestion/data": { delete: { summary: "Delete all social data (posts, users, ...)", security: admin, responses: { 200: { description: "ok" } } } },
    "/api/cache/stats": { get: { summary: "Redis health, hits/misses, hit ratio, latency, timeline, invalidations", responses: { 200: { description: "ok" } } } },
    "/api/cache/invalidate": {
      post: {
        summary: "Invalidate cached entries (all, or by namespace)",
        security: admin,
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { namespaces: { type: "array", items: { type: "string", enum: ["analytics:overview", "analytics:trends", "analytics:sentiment", "analytics:engagement", "posts:"] } } } } } } },
        responses: { 200: { description: "Number of deleted keys" } },
      },
    },
    "/api/cache/stats/reset": { post: { summary: "Reset hit/miss counters", security: admin, responses: { 200: { description: "ok" } } } },
    "/api/benchmark/results": { get: { summary: "Stored benchmark runs (CLI and API)", responses: { 200: { description: "ok" } } } },
    "/api/benchmark/run": {
      post: {
        summary: "Run a quick MongoDB vs Redis benchmark on the live dataset",
        security: admin,
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { iterations: { type: "integer", default: 30 }, warmup: { type: "integer", default: 5 }, workloadRequests: { type: "integer", default: 200 } } } } } },
        responses: { 201: { description: "Benchmark result" } },
      },
    },
  },
};
