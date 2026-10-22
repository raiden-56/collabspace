import { Redis } from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

let client: Redis | null | undefined;

/** Optional Redis connection used for cross-instance fan-out. Null when REDIS_URL is unset. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!config.REDIS_URL) {
    client = null;
    return client;
  }
  try {
    const r = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    r.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
    r.connect().catch((err) => {
      logger.warn({ err: err.message }, "redis unavailable — running single-instance");
      client = null;
    });
    client = r;
  } catch (err) {
    logger.warn({ err }, "redis init failed");
    client = null;
  }
  return client;
}
