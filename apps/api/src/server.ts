import { config } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { prisma } from "@collabspace/db";
import { startJobWorker, stopJobWorker } from "./services/ai/jobs.js";
import { scanOverdueTasks, retryFailedExecutions } from "./services/automation.js";
import { purgeDeletedFiles } from "./routes/files.js";
import { storage } from "./lib/storage.js";

const app = createApp();

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV, storage: storage().name, ai: config.AI_PROVIDER, email: config.EMAIL_DRIVER }, `CollabSpace API listening on http://localhost:${config.API_PORT}`);
});

// Background work: AI job worker + periodic maintenance (overdue scan, automation retries, file purge, session cleanup).
startJobWorker();
const maintenance = setInterval(async () => {
  try {
    const [overdue, retried, purged] = await Promise.all([scanOverdueTasks(), retryFailedExecutions(), purgeDeletedFiles()]);
    const expired = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } }, { revokedAt: { lt: new Date(Date.now() - 7 * 86400_000) } }] } });
    if (overdue || retried || purged || expired.count) logger.info({ overdue, retried, purged, expiredSessions: expired.count }, "maintenance tick");
  } catch (err) {
    logger.warn({ err }, "maintenance tick failed");
  }
}, 60_000);
maintenance.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopJobWorker();
  clearInterval(maintenance);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
