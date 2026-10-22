import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CreateDocumentInput, UpdateDocumentInput, CreateVersionInput, RestoreVersionInput, FolderInput, CreateTaskInput, DOCUMENT_TEMPLATES, ch } from "@collabspace/shared";
import { yDocToTiptapJson, documentPlainText, extractChecklistItems } from "@collabspace/shared/editor";
import { z } from "zod";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest } from "../lib/errors.js";
import { requireAuth, requireAuthUnlessShare } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { emit } from "../lib/realtime.js";
import { assertAccess, requireWorkspaceRole, visibleResourceWhere } from "../services/access.js";
import { createVersion, listVersions, loadDoc, loadVersionDoc, restoreVersion, saveFullState, seedDocumentContent } from "../services/collab.js";
import { findWorkspace } from "./workspaces.js";
import { shapeTask, taskInclude } from "./tasks.js";
import { nextTaskNumber } from "../services/projects.js";

export const documentsRouter = Router();
export const workspaceDocumentsRouter = Router({ mergeParams: true });
export const foldersRouter = Router({ mergeParams: true });
documentsRouter.use(requireAuthUnlessShare);
workspaceDocumentsRouter.use(requireAuth);
foldersRouter.use(requireAuth);

const documentInclude = {
  createdBy: { select: { id: true, name: true, avatarUrl: true, color: true } },
  project: { select: { id: true, name: true, key: true, color: true } },
  workspace: { select: { id: true, slug: true, name: true } },
  folder: { select: { id: true, name: true } },
} as const;

workspaceDocumentsRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const where = await visibleResourceWhere(req.user!, ws.id, "DOCUMENT", role);
    const archived = req.query.archived === "true";
    const rows = await prisma.document.findMany({
      where: { workspaceId: ws.id, deletedAt: null, archivedAt: archived ? { not: null } : null, ...where, ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}), ...(req.query.folderId ? { folderId: String(req.query.folderId) } : {}) },
      orderBy: { updatedAt: "desc" },
      include: documentInclude,
    });
    ok(res, rows);
  }),
);

documentsRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateDocumentInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId, "MEMBER");
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const tpl = input.templateKey ? DOCUMENT_TEMPLATES.find((t) => t.key === input.templateKey) : undefined;
    if (input.templateKey && !tpl) throw badRequest("Unknown document template");
    const document = await prisma.document.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        folderId: input.folderId ?? null,
        title: input.title === "Untitled document" && tpl ? tpl.name : input.title,
        icon: input.icon ?? tpl?.icon ?? null,
        visibility: input.visibility,
        createdById: req.user!.id,
        templateKey: input.templateKey ?? null,
      },
      include: documentInclude,
    });
    await seedDocumentContent(document.id, input.content ?? tpl?.content);
    await recordActivity({ workspaceId: document.workspaceId, projectId: document.projectId, actorId: req.user!.id, type: "document.created", resourceType: "DOCUMENT", resourceId: document.id, resourceTitle: document.title });
    created(res, { ...document, access: "OWNER" });
  }),
);

documentsRouter.get(
  "/:documentId",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    const { access } = await assertAccess(req.user, "DOCUMENT", id, "VIEWER", shareToken);
    const document = await prisma.document.findUniqueOrThrow({ where: { id }, include: documentInclude });
    if (req.user) {
      void prisma.recentItem.upsert({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: "DOCUMENT", resourceId: id } }, update: { openedAt: new Date() }, create: { userId: req.user.id, resourceType: "DOCUMENT", resourceId: id, workspaceId: document.workspaceId } }).catch(() => {});
    }
    const favorite = req.user ? Boolean(await prisma.favorite.findUnique({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: "DOCUMENT", resourceId: id } } })) : false;
    const meeting = await prisma.meeting.findFirst({ where: { notesDocumentId: id }, select: { id: true, title: true } });
    ok(res, { ...document, access, favorite, meeting });
  }),
);

documentsRouter.get(
  "/:documentId/content",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    await assertAccess(req.user, "DOCUMENT", id, "VIEWER", shareToken);
    const doc = await loadDoc("document", id);
    ok(res, { json: yDocToTiptapJson(doc), text: documentPlainText(doc), checklist: extractChecklistItems(doc) });
  }),
);

documentsRouter.patch(
  "/:documentId",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const { resource } = await assertAccess(req.user, "DOCUMENT", id, "EDITOR");
    const input = parseBody(UpdateDocumentInput, req.body);
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const document = await prisma.document.update({
      where: { id },
      data: { title: input.title, icon: input.icon, projectId: input.projectId, folderId: input.folderId, visibility: input.visibility, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null },
      include: documentInclude,
    });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: document.projectId, actorId: req.user!.id, type: input.archived ? "document.archived" : input.archived === false ? "document.restored" : "document.updated", resourceType: "DOCUMENT", resourceId: id, resourceTitle: document.title, payload: { fields: Object.keys(input) } });
    emit([ch.resource("DOCUMENT", id)], { t: "resource:updated", p: { resourceType: "DOCUMENT", resourceId: id, workspaceId: resource.workspaceId, action: "updated", actorId: req.user!.id, patch: { title: document.title, icon: document.icon } } });
    ok(res, document);
  }),
);

documentsRouter.delete(
  "/:documentId",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const { resource } = await assertAccess(req.user, "DOCUMENT", id, "EDITOR");
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "document.deleted", resourceType: "DOCUMENT", resourceId: id, resourceTitle: resource.title });
    noContent(res);
  }),
);

documentsRouter.post(
  "/:documentId/duplicate",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const { resource } = await assertAccess(req.user, "DOCUMENT", id, "VIEWER");
    await requireWorkspaceRole(req.user, resource.workspaceId, "MEMBER");
    const src = await prisma.document.findUniqueOrThrow({ where: { id } });
    const copy = await prisma.document.create({ data: { workspaceId: src.workspaceId, projectId: src.projectId, folderId: src.folderId, title: `${src.title} (copy)`, icon: src.icon, visibility: "PRIVATE", createdById: req.user!.id }, include: documentInclude });
    const doc = await loadDoc("document", id);
    await saveFullState("document", copy.id, doc);
    created(res, copy);
  }),
);

// ---- Versions ---------------------------------------------------------------

documentsRouter.get(
  "/:documentId/versions",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    await assertAccess(req.user, "DOCUMENT", id, "VIEWER");
    ok(res, await listVersions("document", id));
  }),
);

documentsRouter.post(
  "/:documentId/versions",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    await assertAccess(req.user, "DOCUMENT", id, "EDITOR");
    const input = parseBody(CreateVersionInput, req.body);
    created(res, await createVersion("document", id, "NAMED", { name: input.name, authorId: req.user!.id }));
  }),
);

documentsRouter.get(
  "/:documentId/versions/:versionId",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    await assertAccess(req.user, "DOCUMENT", id, "VIEWER");
    const doc = await loadVersionDoc("document", id, requireParam(req, "versionId"));
    ok(res, { json: yDocToTiptapJson(doc), text: documentPlainText(doc) });
  }),
);

documentsRouter.post(
  "/:documentId/restore",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const { resource } = await assertAccess(req.user, "DOCUMENT", id, "EDITOR");
    const input = parseBody(RestoreVersionInput, req.body);
    const { version } = await restoreVersion("document", id, input.versionId, req.user!.id, resource.workspaceId, resource.projectId, resource.title);
    emit([ch.resource("DOCUMENT", id)], { t: "resource:updated", p: { resourceType: "DOCUMENT", resourceId: id, workspaceId: resource.workspaceId, action: "restored", actorId: req.user!.id } });
    ok(res, version);
  }),
);

// ---- Checklist → task ---------------------------------------------------------

documentsRouter.post(
  "/:documentId/convert-to-task",
  h(async (req, res) => {
    const id = requireParam(req, "documentId");
    const { resource } = await assertAccess(req.user, "DOCUMENT", id, "EDITOR");
    const input = parseBody(CreateTaskInput.partial().extend({ projectId: z.string(), text: z.string().min(1).max(500) }), req.body);
    await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const board = await prisma.board.findFirst({ where: { projectId: input.projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
    const task = await prisma.$transaction(async (tx) => {
      const number = await nextTaskNumber(tx, input.projectId);
      return tx.task.create({
        data: {
          workspaceId: resource.workspaceId,
          projectId: input.projectId,
          number,
          title: (input.title ?? input.text).slice(0, 300),
          description: input.description ?? "",
          status: input.status ?? board?.columns[0]?.statusKey ?? "todo",
          priority: input.priority ?? "NONE",
          assigneeId: input.assigneeId ?? null,
          reporterId: req.user!.id,
          dueDate: input.dueDate ?? null,
          position: Date.now(),
          sourceType: "doc-item",
          sourceId: id,
          sourceMeta: { documentId: id, documentTitle: resource.title, text: input.text },
          activities: { create: { actorId: req.user!.id, type: "created", payload: { from: "doc-item", documentId: id } } },
        },
        include: taskInclude,
      });
    });
    const shaped = shapeTask(task);
    await recordActivity({ workspaceId: resource.workspaceId, projectId: input.projectId, actorId: req.user!.id, type: "task.created", resourceType: "TASK", resourceId: task.id, resourceTitle: task.title, payload: { key: shaped.key, source: "doc-item", documentId: id } });
    emit([ch.project(input.projectId), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId: input.projectId, taskId: task.id, action: "created", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
    created(res, shaped);
  }),
);

// ---- Folders ------------------------------------------------------------------

foldersRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    ok(res, await prisma.folder.findMany({ where: { workspaceId: ws.id }, orderBy: { name: "asc" }, include: { _count: { select: { documents: true, canvases: true } } } }));
  }),
);

foldersRouter.post(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(FolderInput, req.body);
    created(res, await prisma.folder.create({ data: { workspaceId: ws.id, name: input.name, parentId: input.parentId ?? null, projectId: input.projectId ?? null } }));
  }),
);

foldersRouter.patch(
  "/:folderId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(FolderInput.partial(), req.body);
    ok(res, await prisma.folder.update({ where: { id: requireParam(req, "folderId") }, data: { name: input.name, parentId: input.parentId } }));
  }),
);

foldersRouter.delete(
  "/:folderId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const id = requireParam(req, "folderId");
    await prisma.$transaction([
      prisma.document.updateMany({ where: { folderId: id }, data: { folderId: null } }),
      prisma.canvas.updateMany({ where: { folderId: id }, data: { folderId: null } }),
      prisma.folder.deleteMany({ where: { id, workspaceId: ws.id } }),
    ]);
    noContent(res);
  }),
);
