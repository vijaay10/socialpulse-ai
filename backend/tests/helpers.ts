import mongoose from "mongoose";
import { createApp, type AppContext } from "../src/app.js";
import { CacheService } from "../src/cache/cacheService.js";
import { loadConfig } from "../src/config.js";
import { syncIndexes } from "../src/models/index.js";
import { NlpClient } from "../src/nlp/nlpClient.js";

export const ADMIN = { "x-api-key": "test-admin-key-123456" };

export async function setupTestApp(opts: { redisUrl?: string } = {}) {
  const config = loadConfig();
  if (!config.MONGODB_URI.includes("_test")) throw new Error("Refusing to run tests against a non-test database");
  if (mongoose.connection.readyState !== 1) await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  const cache = await CacheService.connect(opts.redisUrl ?? config.REDIS_URL, { prefix: config.REDIS_KEY_PREFIX, commandTimeoutMs: 500 }, opts.redisUrl ? 300 : 3000);
  const nlp = new NlpClient(config.NLP_SERVICE_URL, { retries: 1 });
  const nlpHealth = await nlp.health();
  if (nlpHealth.status !== "up") throw new Error(`NLP service not reachable at ${config.NLP_SERVICE_URL}: start it with 'docker compose up -d nlp'`);
  const ctx: AppContext = { config, cache, nlp };
  return { ctx, app: createApp(ctx) };
}

export async function teardown(ctx: AppContext) {
  await ctx.cache.invalidate([], "test teardown");
  await ctx.cache.resetStats();
  await ctx.cache.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
