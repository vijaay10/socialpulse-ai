import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

// Load backend/.env first, then the repository-root .env (values already set win).
dotenv.config({ quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), quiet: true });

const intFromEnv = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: intFromEnv(4000),
  LOG_LEVEL: z.string().default("info"),
  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/socialpulse"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  REDIS_KEY_PREFIX: z.string().min(1).default("sp"),
  REDIS_COMMAND_TIMEOUT_MS: intFromEnv(500),
  CACHE_TTL_TRENDS: intFromEnv(60),
  CACHE_TTL_OVERVIEW: intFromEnv(60),
  CACHE_TTL_SENTIMENT: intFromEnv(120),
  CACHE_TTL_ENGAGEMENT: intFromEnv(120),
  CACHE_TTL_POSTS: intFromEnv(30),
  NLP_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:8080"),
  RATE_LIMIT_PER_MINUTE: intFromEnv(300),
  UPLOAD_MAX_MB: intFromEnv(10),
  ADMIN_API_KEY: z.string().min(8, "ADMIN_API_KEY must be at least 8 characters"),
});

export type Config = z.infer<typeof schema> & {
  cacheTtl: Record<CacheNamespaceGroup, number>;
  corsOrigins: string[];
};

export type CacheNamespaceGroup = "trends" | "overview" | "sentiment" | "engagement" | "posts";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  const c = parsed.data;
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    cacheTtl: {
      trends: c.CACHE_TTL_TRENDS,
      overview: c.CACHE_TTL_OVERVIEW,
      sentiment: c.CACHE_TTL_SENTIMENT,
      engagement: c.CACHE_TTL_ENGAGEMENT,
      posts: c.CACHE_TTL_POSTS,
    },
  };
}
