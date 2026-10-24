import { createApp } from "./app.js";
import { CacheService } from "./cache/cacheService.js";
import { loadConfig } from "./config.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { logger } from "./logger.js";
import { syncIndexes } from "./models/index.js";
import { NlpClient } from "./nlp/nlpClient.js";

async function main() {
  const config = loadConfig();
  await connectMongo(config.MONGODB_URI);
  await syncIndexes();
  const cache = await CacheService.connect(config.REDIS_URL, { prefix: config.REDIS_KEY_PREFIX, commandTimeoutMs: config.REDIS_COMMAND_TIMEOUT_MS });
  const nlp = new NlpClient(config.NLP_SERVICE_URL);
  const app = createApp({ config, cache, nlp });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "SocialPulse API listening"));
  server.requestTimeout = 5 * 60_000; // large uploads/seeds

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close();
    await Promise.allSettled([cache.close(), disconnectMongo()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start");
  process.exit(1);
});
