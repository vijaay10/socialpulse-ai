import { randomUUID } from "node:crypto";

// Isolated test resources: a dedicated MongoDB database and a unique Redis key namespace per run.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? "mongodb://localhost:27017/socialpulse_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
process.env.REDIS_KEY_PREFIX = `sp:test:${randomUUID().slice(0, 8)}`;
process.env.NLP_SERVICE_URL = process.env.TEST_NLP_SERVICE_URL ?? "http://localhost:8000";
process.env.ADMIN_API_KEY = "test-admin-key-123456";
