import mongoose from "mongoose";
import { logger } from "../logger.js";
import { HttpError } from "../middleware/errors.js";

export const MONGO_UNAVAILABLE = "MongoDB is unavailable. Only analytics already cached in Redis can be served until it reconnects.";

/** Fail fast (503) instead of letting queries queue while MongoDB is disconnected. */
export function assertMongoReady(): void {
  if (mongoose.connection.readyState !== 1) throw new HttpError(503, MONGO_UNAVAILABLE);
}

/** Wrap a cache loader so a cache hit still works when MongoDB is down, but a miss fails fast. */
export const withMongo = <T>(fn: () => Promise<T>) => (): Promise<T> => {
  assertMongoReady();
  return fn();
};

export function isMongoConnectionError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return /Mongo(oose)?(ServerSelection|Network|NotConnected|Topology)/.test(name) || /buffering timed out/.test(message);
}

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  // Queries issued while disconnected fail after 3 s instead of the 10 s default.
  mongoose.set("bufferTimeoutMS", 3000);
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
  logger.info({ db: mongoose.connection.name }, "MongoDB connected");
  return mongoose;
}

export async function mongoHealth(): Promise<{ status: "up" | "down"; latencyMs?: number; database?: string; error?: string }> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) return { status: "down", error: "not connected" };
  const started = performance.now();
  try {
    await db.admin().ping();
    return { status: "up", latencyMs: round(performance.now() - started), database: db.databaseName };
  } catch (err) {
    return { status: "down", error: (err as Error).message };
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

const round = (n: number) => Math.round(n * 100) / 100;
