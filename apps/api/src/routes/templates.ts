import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CANVAS_TEMPLATES, DOCUMENT_TEMPLATES, PROJECT_TEMPLATES, InstantiateTemplateInput, buildCanvasTemplate } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, created, requireParam } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { assertAccess, requireWorkspaceRole } from "../services/access.js";
import { seedCanvasFromTemplate, seedDocumentContent } from "../services/collab.js";
import { createProjectFromTemplate } from "../services/projects.js";

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

export function templateGallery() {
  return [
    ...CANVAS_TEMPLATES.map((t) => ({ key: t.key, kind: "CANVAS" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, objectCount: buildCanvasTemplate(t.key, "p")?.objects.length ?? 0 })),
    ...DOCUMENT_TEMPLATES.map((t) => ({ key: t.key, kind: "DOCUMENT" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, icon: t.icon })),
    ...PROJECT_TEMPLATES.map((t) => ({ key: t.key, kind: "PROJECT" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, icon: t.icon, color: t.color, taskCount: t.tasks.length, documentCount: t.documents.length, canvasCount: t.canvasTemplateKeys.length })),
  ];
}

templatesRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(z.object({ q: z.string().optional(), kind: z.enum(["CANVAS", "DOCUMENT", "PROJECT"]).optional(), category: z.string().optional() }), req.query);
    let items = templateGallery();
    if (q.kind) items = items.filter((t) => t.kind === q.kind);
    if (q.category) items = items.filter((t) => t.category.toLowerCase() === q.category!.toLowerCase());
    if (q.q) {
      const s = q.q.toLowerCase();
      items = items.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s) || t.tags.some((tag) => tag.includes(s)) || t.category.toLowerCase().includes(s));
    }
    ok(res, { items, categories: [...new Set(templateGallery().map((t) => t.category))].sort() });
  }),
);

templatesRouter.get(
  "/:key/preview",
  h(async (req, res) => {
    const key = requireParam(req, "key");
    const canvas = CANVAS_TEMPLATES.find((t) => t.key === key);
    if (canvas) return ok(res, { kind: "CANVAS", snapshot: buildCanvasTemplate(key, "preview") });
    const docTpl = DOCUMENT_TEMPLATES.find((t) => t.key === key);
    if (docTpl) return ok(res, { kind: "DOCUMENT", content: docTpl.content });
    const project = PROJECT_TEMPLATES.find((t) => t.key === key);
    if (project) return ok(res, { kind: "PROJECT", tasks: project.tasks, documents: project.documents.map((d) => d.title), canvases: project.canvasTemplateKeys, milestones: project.milestones ?? [], labels: project.labels });
    throw notFound("Template");
  }),
);

templatesRouter.post(
  "/:key/instantiate",
  h(async (req, res) => {
    const key = requireParam(req, "key");
    const input = parseBody(InstantiateTemplateInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId, "MEMBER");
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const canvasTpl = CANVAS_TEMPLATES.find((t) => t.key === key);
    if (canvasTpl) {
      const canvas = await prisma.canvas.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId ?? null, title: input.title ?? canvasTpl.name, createdById: req.user!.id, templateKey: key } });
      await seedCanvasFromTemplate(canvas.id, key, req.user!.id);
      await recordActivity({ workspaceId: input.workspaceId, projectId: canvas.projectId, actorId: req.user!.id, type: "canvas.created", resourceType: "CANVAS", resourceId: canvas.id, resourceTitle: canvas.title, payload: { templateKey: key } });
      return created(res, { kind: "CANVAS", id: canvas.id, title: canvas.title });
    }
    const docTpl = DOCUMENT_TEMPLATES.find((t) => t.key === key);
    if (docTpl) {
      const document = await prisma.document.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId ?? null, title: input.title ?? docTpl.name, icon: docTpl.icon, createdById: req.user!.id, templateKey: key } });
      await seedDocumentContent(document.id, docTpl.content);
      await recordActivity({ workspaceId: input.workspaceId, projectId: document.projectId, actorId: req.user!.id, type: "document.created", resourceType: "DOCUMENT", resourceId: document.id, resourceTitle: document.title, payload: { templateKey: key } });
      return created(res, { kind: "DOCUMENT", id: document.id, title: document.title });
    }
    const projectTpl = PROJECT_TEMPLATES.find((t) => t.key === key);
    if (projectTpl) {
      const project = await createProjectFromTemplate({ workspaceId: input.workspaceId, ownerId: req.user!.id, templateKey: key, name: input.title });
      return created(res, { kind: "PROJECT", id: project.id, title: project.name, boardId: project.boards[0]?.id });
    }
    throw badRequest("Unknown template");
  }),
);
