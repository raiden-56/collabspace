import "dotenv/config";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

// Load the repo-root .env when running from apps/api (dotenv/config only reads cwd).
for (const candidate of [path.resolve(process.cwd(), "../../.env"), path.resolve(process.cwd(), "../.env")]) {
  if (fs.existsSync(candidate)) {
    const { config } = await import("dotenv");
    config({ path: candidate, override: false });
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: bool,
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4100"),
  SYNC_URL: z.string().url().default("http://localhost:4101"),
  TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  INTERNAL_EVENT_SECRET: z.string().min(8),
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().default(25 * 1024 * 1024),
  EMAIL_DRIVER: z.enum(["smtp", "log", "disabled"]).default("log"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool,
  EMAIL_FROM: z.string().default("CollabSpace <no-reply@collabspace.local>"),
  AI_PROVIDER: z.enum(["anthropic", "mock", "disabled"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5-5"),
  AI_MAX_INPUT_CHARS: z.coerce.number().default(120000),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:\n" + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  sessionCookie: "cs_session",
  sessionTtlMs: parsed.data.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
};
export type Config = typeof config;
