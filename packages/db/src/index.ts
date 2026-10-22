import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
import { config as loadEnv } from "dotenv";

// Load the nearest .env (walking up from cwd) so every consumer — API, sync service, tests, seed —
// sees DATABASE_URL regardless of import order. Existing process.env values always win.
(() => {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      loadEnv({ path: candidate, override: false });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
})();

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
