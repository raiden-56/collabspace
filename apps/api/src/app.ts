import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { generateOpenApiDocument } from "./lib/openapi.js";
import { attachUser } from "./middleware/auth.js";
import { csrfGuard } from "./middleware/csrf.js";
import { rateLimit } from "./lib/rateLimit.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { workspacesRouter, invitationsRouter } from "./routes/workspaces.js";
import { projectsRouter, workspaceProjectsRouter } from "./routes/projects.js";
import { tasksRouter, projectTasksRouter, workspaceTasksRouter, boardsRouter, labelsRouter } from "./routes/tasks.js";
import { canvasesRouter, workspaceCanvasesRouter } from "./routes/canvases.js";
import { documentsRouter, workspaceDocumentsRouter, foldersRouter } from "./routes/documents.js";
import { commentsRouter, threadsRouter } from "./routes/comments.js";
import { meetingsRouter, workspaceMeetingsRouter } from "./routes/meetings.js";
import { channelsRouter, workspaceChannelsRouter, messagesRouter } from "./routes/chat.js";
import { notificationsRouter } from "./routes/notifications.js";
import { filesRouter, workspaceFilesRouter } from "./routes/files.js";
import { searchRouter } from "./routes/search.js";
import { shareLinksRouter, sharedRouter, permissionsRouter } from "./routes/share.js";
import { templatesRouter } from "./routes/templates.js";
import { workspaceAutomationRouter, automationRulesRouter, automationExecutionsRouter } from "./routes/automation.js";
import { calendarRouter } from "./routes/calendar.js";
import { adminRouter } from "./routes/admin.js";
import { aiRouter } from "./routes/ai.js";
import { healthRouter } from "./routes/health.js";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.TRUSTED_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    }),
  );
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" } }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use(csrfGuard);
  app.use(rateLimit({ name: "global", windowMs: 60_000, max: 600 }));

  app.use(healthRouter);

  const v1 = express.Router();
  v1.use("/auth", authRouter);
  v1.use("/users", usersRouter);
  v1.use("/workspaces", workspacesRouter);
  v1.use("/workspaces/:workspaceId/projects", workspaceProjectsRouter);
  v1.use("/workspaces/:workspaceId/tasks", workspaceTasksRouter);
  v1.use("/workspaces/:workspaceId/labels", labelsRouter);
  v1.use("/workspaces/:workspaceId/canvases", workspaceCanvasesRouter);
  v1.use("/workspaces/:workspaceId/documents", workspaceDocumentsRouter);
  v1.use("/workspaces/:workspaceId/folders", foldersRouter);
  v1.use("/workspaces/:workspaceId/meetings", workspaceMeetingsRouter);
  v1.use("/workspaces/:workspaceId/channels", workspaceChannelsRouter);
  v1.use("/workspaces/:workspaceId/files", workspaceFilesRouter);
  v1.use("/workspaces/:workspaceId/automation", workspaceAutomationRouter);
  v1.use("/workspaces/:workspaceId/calendar", calendarRouter);
  v1.use("/invitations", invitationsRouter);
  v1.use("/projects", projectsRouter);
  v1.use("/projects/:projectId/tasks", projectTasksRouter);
  v1.use("/tasks", tasksRouter);
  v1.use("/boards", boardsRouter);
  v1.use("/canvases", canvasesRouter);
  v1.use("/documents", documentsRouter);
  v1.use("/comments", commentsRouter);
  v1.use("/comment-threads", threadsRouter);
  v1.use("/meetings", meetingsRouter);
  v1.use("/channels", channelsRouter);
  v1.use("/messages", messagesRouter);
  v1.use("/notifications", notificationsRouter);
  v1.use("/files", filesRouter);
  v1.use("/search", searchRouter);
  v1.use("/share-links", shareLinksRouter);
  v1.use("/shared", sharedRouter);
  v1.use("/permissions", permissionsRouter);
  v1.use("/templates", templatesRouter);
  v1.use("/automation/rules", automationRulesRouter);
  v1.use("/automation/executions", automationExecutionsRouter);
  v1.use("/admin", adminRouter);
  v1.use("/ai", aiRouter);

  const openapi = generateOpenApiDocument();
  v1.get("/openapi.json", (_req, res) => res.json(openapi));
  v1.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "CollabSpace API" }));

  app.use("/api/v1", v1);

  app.use((_req, _res, next) => next(notFound("Route")));
  app.use(errorHandler);
  return app;
}
