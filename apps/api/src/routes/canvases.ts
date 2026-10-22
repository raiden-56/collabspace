import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CreateCanvasInput, UpdateCanvasInput, CreateVersionInput, RestoreVersionInput, CreateTaskInput, canvas as canvasLib, ch } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth, requireAuthUnlessShare } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { emit } from "../lib/realtime.js";
import { assertAccess, requireWorkspaceRole, visibleResourceWhere } from "../services/access.js";
import { createVersion, listVersions, loadDoc, loadVersionDoc, restoreVersion, seedCanvasFromTemplate } from "../services/collab.js";
import { findWorkspace } from "./workspaces.js";
import { shapeTask, taskInclude } from "./tasks.js";
import { nextTaskNumber } from "../services/projects.js";

export const canvasesRouter = Router();
export const workspaceCanvasesRouter = Router({ mergeParams: true });
canvasesRouter.use(requireAuthUnlessShare);
workspaceCanvasesRouter.use(requireAuth);

const canvasInclude = {
  createdBy: { select: { id: true, name: true, avatarUrl: true, color: true } },
  project: { select: { id: true, name: true, key: true, color: true } },
  workspace: { select: { id: true, slug: true, name: true } },
} as const;

workspaceCanvasesRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const where = await visibleResourceWhere(req.user!, ws.id, "CANVAS", role);
    const archived = req.query.archived === "true";
    const rows = await prisma.canvas.findMany({ where: { workspaceId: ws.id, deletedAt: null, archivedAt: archived ? { not: null } : null, ...where, ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}) }, orderBy: { updatedAt: "desc" }, include: canvasInclude });
    ok(res, rows);
  }),
);

canvasesRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateCanvasInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId, "MEMBER");
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const canvas = await prisma.canvas.create({
      data: { workspaceId: input.workspaceId, projectId: input.projectId ?? null, folderId: input.folderId ?? null, title: input.title, description: input.description ?? null, visibility: input.visibility, createdById: req.user!.id, templateKey: input.templateKey ?? null },
      include: canvasInclude,
    });
    await seedCanvasFromTemplate(canvas.id, input.templateKey, req.user!.id);
    await recordActivity({ workspaceId: canvas.workspaceId, projectId: canvas.projectId, actorId: req.user!.id, type: "canvas.created", resourceType: "CANVAS", resourceId: canvas.id, resourceTitle: canvas.title });
    created(res, { ...canvas, access: "OWNER" });
  }),
);

canvasesRouter.get(
  "/:canvasId",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    const { access } = await assertAccess(req.user, "CANVAS", id, "VIEWER", shareToken);
    const canvas = await prisma.canvas.findUniqueOrThrow({ where: { id }, include: canvasInclude });
    if (req.user) {
      void prisma.recentItem.upsert({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: "CANVAS", resourceId: id } }, update: { openedAt: new Date() }, create: { userId: req.user.id, resourceType: "CANVAS", resourceId: id, workspaceId: canvas.workspaceId } }).catch(() => {});
    }
    const favorite = req.user ? Boolean(await prisma.favorite.findUnique({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: "CANVAS", resourceId: id } } })) : false;
    ok(res, { ...canvas, access, favorite });
  }),
);

/** Snapshot of the current content (for AI, exports, previews). Live editing goes through the sync service. */
canvasesRouter.get(
  "/:canvasId/snapshot",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    await assertAccess(req.user, "CANVAS", id, "VIEWER", shareToken);
    const doc = await loadDoc("canvas", id);
    ok(res, canvasLib.serializeCanvas(doc));
  }),
);

canvasesRouter.patch(
  "/:canvasId",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const { resource } = await assertAccess(req.user, "CANVAS", id, "EDITOR");
    const input = parseBody(UpdateCanvasInput, req.body);
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const canvas = await prisma.canvas.update({
      where: { id },
      data: { title: input.title, description: input.description, projectId: input.projectId, folderId: input.folderId, visibility: input.visibility, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null },
      include: canvasInclude,
    });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: canvas.projectId, actorId: req.user!.id, type: input.archived ? "canvas.archived" : input.archived === false ? "canvas.restored" : "canvas.updated", resourceType: "CANVAS", resourceId: id, resourceTitle: canvas.title, payload: { fields: Object.keys(input) } });
    emit([ch.resource("CANVAS", id)], { t: "resource:updated", p: { resourceType: "CANVAS", resourceId: id, workspaceId: resource.workspaceId, action: "updated", actorId: req.user!.id, patch: { title: canvas.title } } });
    ok(res, canvas);
  }),
);

canvasesRouter.delete(
  "/:canvasId",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const { resource } = await assertAccess(req.user, "CANVAS", id, "EDITOR");
    await prisma.canvas.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "canvas.deleted", resourceType: "CANVAS", resourceId: id, resourceTitle: resource.title });
    noContent(res);
  }),
);

canvasesRouter.post(
  "/:canvasId/duplicate",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const { resource } = await assertAccess(req.user, "CANVAS", id, "VIEWER");
    await requireWorkspaceRole(req.user, resource.workspaceId, "MEMBER");
    const src = await prisma.canvas.findUniqueOrThrow({ where: { id } });
    const copy = await prisma.canvas.create({ data: { workspaceId: src.workspaceId, projectId: src.projectId, folderId: src.folderId, title: `${src.title} (copy)`, description: src.description, visibility: "PRIVATE", createdById: req.user!.id }, include: canvasInclude });
    const doc = await loadDoc("canvas", id);
    const { saveFullState } = await import("../services/collab.js");
    await saveFullState("canvas", copy.id, doc);
    created(res, copy);
  }),
);

// ---- Versions ---------------------------------------------------------------

canvasesRouter.get(
  "/:canvasId/versions",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    await assertAccess(req.user, "CANVAS", id, "VIEWER");
    ok(res, await listVersions("canvas", id));
  }),
);

canvasesRouter.post(
  "/:canvasId/versions",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    await assertAccess(req.user, "CANVAS", id, "EDITOR");
    const input = parseBody(CreateVersionInput, req.body);
    created(res, await createVersion("canvas", id, "NAMED", { name: input.name, authorId: req.user!.id }));
  }),
);

canvasesRouter.get(
  "/:canvasId/versions/:versionId",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    await assertAccess(req.user, "CANVAS", id, "VIEWER");
    const doc = await loadVersionDoc("canvas", id, requireParam(req, "versionId"));
    ok(res, canvasLib.serializeCanvas(doc));
  }),
);

canvasesRouter.post(
  "/:canvasId/restore",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const { resource } = await assertAccess(req.user, "CANVAS", id, "EDITOR");
    const input = parseBody(RestoreVersionInput, req.body);
    const { version } = await restoreVersion("canvas", id, input.versionId, req.user!.id, resource.workspaceId, resource.projectId, resource.title);
    // Tell the sync service to reload the room so connected clients receive the restored state.
    emit([ch.resource("CANVAS", id)], { t: "resource:updated", p: { resourceType: "CANVAS", resourceId: id, workspaceId: resource.workspaceId, action: "restored", actorId: req.user!.id } });
    ok(res, version);
  }),
);

// ---- Convert a note into a task ------------------------------------------------

canvasesRouter.post(
  "/:canvasId/objects/:objectId/convert-to-task",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const objectId = requireParam(req, "objectId");
    const { resource } = await assertAccess(req.user, "CANVAS", id, "EDITOR");
    const input = parseBody(CreateTaskInput.partial().extend({ projectId: z.string() }), req.body);
    await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const doc = await loadDoc("canvas", id);
    const ymap = canvasLib.getObjectsMap(doc).get(objectId);
    const obj = ymap ? canvasLib.readObject(ymap) : null;
    if (!obj) throw notFound("Canvas object");
    const title = input.title ?? (obj.text || obj.title || "Untitled task").split("\n")[0]!.slice(0, 200);
    if (!title.trim()) throw badRequest("The note is empty");
    const board = await prisma.board.findFirst({ where: { projectId: input.projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
    const status = input.status ?? board?.columns[0]?.statusKey ?? "todo";
    const task = await prisma.$transaction(async (tx) => {
      const number = await nextTaskNumber(tx, input.projectId);
      return tx.task.create({
        data: {
          workspaceId: resource.workspaceId,
          projectId: input.projectId,
          number,
          title,
          description: input.description ?? (obj.text && obj.text !== title ? obj.text : ""),
          status,
          priority: input.priority ?? "NONE",
          assigneeId: input.assigneeId ?? null,
          reporterId: req.user!.id,
          dueDate: input.dueDate ?? null,
          position: Date.now(),
          sourceType: "canvas-note",
          sourceId: objectId,
          sourceMeta: { canvasId: id, canvasTitle: resource.title },
          activities: { create: { actorId: req.user!.id, type: "created", payload: { from: "canvas-note", canvasId: id } } },
        },
        include: taskInclude,
      });
    });
    const shaped = shapeTask(task);
    await recordActivity({ workspaceId: resource.workspaceId, projectId: input.projectId, actorId: req.user!.id, type: "task.created", resourceType: "TASK", resourceId: task.id, resourceTitle: task.title, payload: { key: shaped.key, source: "canvas-note", canvasId: id } });
    emit([ch.project(input.projectId), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId: input.projectId, taskId: task.id, action: "created", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
    created(res, shaped);
  }),
);

/** Resolve linked task/document cards for rendering on the canvas (permission-aware). */
canvasesRouter.post(
  "/:canvasId/resolve-links",
  h(async (req, res) => {
    const id = requireParam(req, "canvasId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    await assertAccess(req.user, "CANVAS", id, "VIEWER", shareToken);
    const input = parseBody(z.object({ taskIds: z.array(z.string()).max(200).default([]), documentIds: z.array(z.string()).max(200).default([]) }), req.body);
    const tasks = input.taskIds.length ? await prisma.task.findMany({ where: { id: { in: input.taskIds }, deletedAt: null }, include: taskInclude }) : [];
    const docs = input.documentIds.length ? await prisma.document.findMany({ where: { id: { in: input.documentIds }, deletedAt: null }, select: { id: true, title: true, icon: true, updatedAt: true, workspaceId: true } }) : [];
    const visibleTasks: Record<string, unknown>[] = [];
    for (const t of tasks) {
      const r = await assertAccess(req.user, "TASK", t.id, "VIEWER").catch(() => null);
      if (r) visibleTasks.push(shapeTask(t));
    }
    const visibleDocs: Record<string, unknown>[] = [];
    for (const d of docs) {
      const r = await assertAccess(req.user, "DOCUMENT", d.id, "VIEWER").catch(() => null);
      if (r) visibleDocs.push(d);
    }
    ok(res, { tasks: visibleTasks, documents: visibleDocs });
  }),
);
