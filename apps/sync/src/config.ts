import "dotenv/config";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

for (const candidate of [path.resolve(process.cwd(), "../../.env"), path.resolve(process.cwd(), "../.env")]) {
  if (fs.existsSync(candidate)) {
    const { config } = await import("dotenv");
    config({ path: candidate, override: false });
  }
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SYNC_PORT: z.coerce.number().default(4101),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16),
  INTERNAL_EVENT_SECRET: z.string().min(8),
  TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid sync service configuration:\n" + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  sessionCookie: "cs_session",
  /** Max inbound messages per connection per second before the socket is closed */
  maxMessagesPerSecond: 120,
  /** Max inbound message size (bytes) */
  maxMessageBytes: 2 * 1024 * 1024,
  heartbeatMs: 30_000,
  /** Unload idle rooms after this long with no connections */
  roomIdleMs: 30_000,
  /** Batch window for persisting Yjs updates */
  persistDebounceMs: 400,
};
