import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.integration.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          env: { NODE_ENV: "test", LOG_LEVEL: "silent", AI_PROVIDER: "mock", EMAIL_DRIVER: "log", STORAGE_DRIVER: "local", LOCAL_UPLOAD_DIR: "./.test-uploads", REDIS_URL: "" },
        },
      },
    ],
  },
});
