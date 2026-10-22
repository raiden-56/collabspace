import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

let client: Redis | null | undefined;

/** Optional Redis connection. Returns null when REDIS_URL is unset or the connection fails. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!config.REDIS_URL) {
    client = null;
    return client;
  }
  try {
    const r = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    r.on("error", (err) => logger.warn({ err: err.message }, "Redis error"));
    r.connect().catch((err) => logger.warn({ err: err.message }, "Redis unavailable — falling back to in-memory"));
    client = r;
  } catch (err) {
    logger.warn({ err }, "Redis init failed");
    client = null;
  }
  return client;
}

export function redisReady(): boolean {
  const r = getRedis();
  return !!r && r.status === "ready";
}
