import { CacheService } from "../cache/cacheService.js";
import { loadConfig } from "../config.js";
import { connectMongo } from "../db/mongo.js";
import { syncIndexes } from "../models/index.js";
import { NlpClient } from "../nlp/nlpClient.js";

export function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

export function withDatabase(uri: string, dbName: string): string {
  const u = new URL(uri);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export async function bootstrap(opts: { uri?: string; cachePrefix?: string } = {}) {
  const config = loadConfig();
  await connectMongo(opts.uri ?? config.MONGODB_URI);
  await syncIndexes();
  const cache = await CacheService.connect(config.REDIS_URL, { prefix: opts.cachePrefix ?? config.REDIS_KEY_PREFIX, commandTimeoutMs: config.REDIS_COMMAND_TIMEOUT_MS });
  const nlp = new NlpClient(config.NLP_SERVICE_URL);
  return { config, cache, nlp };
}
