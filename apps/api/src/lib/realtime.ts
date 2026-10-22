import type { ServerEvent } from "@collabspace/shared";
import { config } from "../config.js";
import { getRedis, redisReady } from "./redis.js";
import { logger } from "./logger.js";

export const REALTIME_REDIS_CHANNEL = "collabspace:events";

/**
 * Publish an application event to the realtime (sync) service.
 * - With Redis: publish to a pub/sub channel every sync instance subscribes to (horizontal scaling).
 * - Without Redis: POST to the sync service's internal endpoint (single instance dev setup).
 * Failures are logged, never thrown — realtime delivery is best-effort; the DB is the source of truth.
 */
export async function publish(channels: string[], event: ServerEvent): Promise<void> {
  if (channels.length === 0) return;
  const payload = JSON.stringify({ channels, event });
  const redis = getRedis();
  if (redis && redisReady()) {
    try {
      await redis.publish(REALTIME_REDIS_CHANNEL, payload);
      return;
    } catch (err) {
      logger.warn({ err }, "Redis publish failed, falling back to HTTP");
    }
  }
  try {
    const res = await fetch(`${config.SYNC_URL}/internal/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": config.INTERNAL_EVENT_SECRET },
      body: payload,
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) logger.warn({ status: res.status }, "Sync service rejected event");
  } catch (err) {
    if (!config.isTest) logger.debug({ err: (err as Error).message }, "Sync service unreachable (event dropped)");
  }
}

/** Fire-and-forget variant. */
export function emit(channels: string[], event: ServerEvent): void {
  void publish(channels, event);
}
