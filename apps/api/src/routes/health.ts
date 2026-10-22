import { Router } from "express";
import { prisma } from "@collabspace/db";
import { h } from "../lib/http.js";
import { redisReady } from "../lib/redis.js";

export const healthRouter = Router();

healthRouter.get(
  "/health",
  h(async (_req, res) => {
    let db = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db, redis: redisReady(), time: new Date().toISOString() });
  }),
);

healthRouter.get("/ready", (_req, res) => {
  res.json({ ready: true });
});
