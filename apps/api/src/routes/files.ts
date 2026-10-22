import { Router } from "express";
import multer from "multer";
import { prisma } from "@collabspace/db";
import { UpdateFileInput, ResourceTypeSchema } from "@collabspace/shared";
import { z } from "zod";
import { config } from "../config.js";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { storage, isAllowedMime } from "../lib/storage.js";
import { sha256 } from "../lib/crypto.js";
import { recordActivity } from "../lib/activity.js";
import { audit } from "../lib/audit.js";
import { rateLimit } from "../lib/rateLimit.js";
import { assertAccess, requireWorkspaceRole } from "../services/access.js";
import { findWorkspace } from "./workspaces.js";

export const filesRouter = Router();
export const workspaceFilesRouter = Router({ mergeParams: true });
workspaceFilesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

const fileSelect = {
  id: true, workspaceId: true, projectId: true, name: true, mimeType: true, sizeBytes: true, status: true, width: true, height: true, altText: true, resourceType: true, resourceId: true, createdAt: true, updatedAt: true,
  uploader: { select: { id: true, name: true, avatarUrl: true, color: true } },
  project: { select: { id: true, name: true, key: true } },
} as const;

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "file";
}

workspaceFilesRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    const q = parseQuery(z.object({ q: z.string().optional(), projectId: z.string().optional(), type: z.enum(["image", "document", "video", "audio", "other"]).optional(), deleted: z.coerce.boolean().optional() }), req.query);
    const mimeFilter = q.type === "image" ? { startsWith: "image/" } : q.type === "video" ? { startsWith: "video/" } : q.type === "audio" ? { startsWith: "audio/" } : q.type === "document" ? { in: ["application/pdf", "text/plain", "text/markdown", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/csv"] } : q.type === "other" ? { notIn: [] as string[], not: { startsWith: "image/" } } : undefined;
    const rows = await prisma.fileAsset.findMany({
      where: { workspaceId: ws.id, status: "READY", deletedAt: q.deleted ? { not: null } : null, ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}), ...(mimeFilter ? { mimeType: mimeFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: fileSelect,
    });
    ok(res, rows);
  }),
);

/** Multipart upload: fields workspaceId, projectId?, resourceType?, resourceId?, altText?; file field "file". */
filesRouter.post(
  "/",
  requireAuth,
  rateLimit({ name: "upload", windowMs: 60 * 60_000, max: 300 }),
  upload.single("file"),
  h(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw badRequest("No file uploaded");
    const body = parseBody(z.object({ workspaceId: z.string(), projectId: z.string().optional(), resourceType: ResourceTypeSchema.optional(), resourceId: z.string().optional(), altText: z.string().max(500).optional(), replaceFileId: z.string().optional() }), req.body);
    await requireWorkspaceRole(req.user, body.workspaceId, "MEMBER");
    if (body.projectId) await assertAccess(req.user, "PROJECT", body.projectId, "EDITOR");
    if (body.resourceType && body.resourceId) await assertAccess(req.user, body.resourceType, body.resourceId, "COMMENTER");
    const mime = (file.mimetype || "application/octet-stream").toLowerCase();
    if (!isAllowedMime(mime)) throw badRequest(`File type ${mime} is not allowed`);
    if (file.size > config.MAX_UPLOAD_BYTES) throw badRequest("File exceeds the maximum upload size");
    const name = safeName(file.originalname);
    const key = `${body.workspaceId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${name}`;
    const record = await prisma.fileAsset.create({
      data: { workspaceId: body.workspaceId, projectId: body.projectId ?? null, uploaderId: req.user!.id, name, mimeType: mime, sizeBytes: file.size, storageKey: key, checksum: sha256(file.buffer), status: "PENDING", altText: body.altText ?? null, resourceType: body.resourceType ?? null, resourceId: body.resourceId ?? null },
    });
    try {
      await storage().put(key, file.buffer, mime, file.size);
    } catch (err) {
      await prisma.fileAsset.update({ where: { id: record.id }, data: { status: "FAILED" } });
      throw new Error(`Storage upload failed: ${(err as Error).message}`);
    }
    const ready = await prisma.fileAsset.update({ where: { id: record.id }, data: { status: "READY" }, select: fileSelect });
    if (body.replaceFileId) {
      const old = await prisma.fileAsset.findFirst({ where: { id: body.replaceFileId, workspaceId: body.workspaceId } });
      if (old && (old.uploaderId === req.user!.id || (await assertAccess(req.user, "FILE", old.id, "EDITOR").catch(() => null)))) {
        await prisma.fileAsset.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
      }
    }
    await recordActivity({ workspaceId: body.workspaceId, projectId: body.projectId ?? null, actorId: req.user!.id, type: "file.uploaded", resourceType: "FILE", resourceId: ready.id, resourceTitle: ready.name, payload: { mimeType: mime, sizeBytes: file.size } });
    await audit({ action: "file.upload", workspaceId: body.workspaceId, req, resourceType: "FILE", resourceId: ready.id, metadata: { mimeType: mime, sizeBytes: file.size } });
    created(res, ready);
  }),
);

filesRouter.get(
  "/:fileId",
  requireAuth,
  h(async (req, res) => {
    const id = requireParam(req, "fileId");
    const { access } = await assertAccess(req.user, "FILE", id, "VIEWER");
    const file = await prisma.fileAsset.findUniqueOrThrow({ where: { id }, select: fileSelect });
    ok(res, { ...file, access });
  }),
);

/** Protected delivery: signed URL redirect (S3) or authenticated stream (local). Share tokens allowed via ?share=. */
filesRouter.get(
  "/:fileId/download",
  h(async (req, res) => {
    const id = requireParam(req, "fileId");
    const shareToken = typeof req.query.share === "string" ? req.query.share : undefined;
    const file = await prisma.fileAsset.findFirst({ where: { id, deletedAt: null, status: "READY" } });
    if (!file) throw notFound("File");
    // Access via the file itself, or via the resource it is attached to (so a shared canvas can show its images).
    const direct = await assertAccess(req.user, "FILE", id, "VIEWER").catch(() => null);
    if (!direct) {
      if (file.resourceType && file.resourceId) await assertAccess(req.user, file.resourceType, file.resourceId, "VIEWER", shareToken);
      else throw notFound("File");
    }
    const inline = req.query.download !== "1";
    const signed = await storage().signedDownloadUrl(file.storageKey, file.name, file.mimeType, 300);
    if (signed) {
      res.redirect(302, signed);
      return;
    }
    const obj = await storage().getStream(file.storageKey);
    if (!obj) throw notFound("File content");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(obj.size ?? file.sizeBytes));
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    obj.stream.pipe(res);
  }),
);

filesRouter.patch(
  "/:fileId",
  requireAuth,
  h(async (req, res) => {
    const id = requireParam(req, "fileId");
    await assertAccess(req.user, "FILE", id, "EDITOR");
    const input = parseBody(UpdateFileInput, req.body);
    ok(res, await prisma.fileAsset.update({ where: { id }, data: { name: input.name ? safeName(input.name) : undefined, altText: input.altText, projectId: input.projectId }, select: fileSelect }));
  }),
);

filesRouter.delete(
  "/:fileId",
  requireAuth,
  h(async (req, res) => {
    const id = requireParam(req, "fileId");
    const { resource } = await assertAccess(req.user, "FILE", id, "EDITOR");
    // Soft delete; content is purged by the retention job after 30 days.
    await prisma.fileAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "file.deleted", resourceType: "FILE", resourceId: id, resourceTitle: resource.title });
    noContent(res);
  }),
);

filesRouter.post(
  "/:fileId/restore",
  requireAuth,
  h(async (req, res) => {
    const id = requireParam(req, "fileId");
    const file = await prisma.fileAsset.findUnique({ where: { id } });
    if (!file || !file.deletedAt) throw notFound("Deleted file");
    await requireWorkspaceRole(req.user, file.workspaceId, "MEMBER");
    ok(res, await prisma.fileAsset.update({ where: { id }, data: { deletedAt: null }, select: fileSelect }));
  }),
);

/** Purge soft-deleted files older than 30 days (called by the scheduler). */
export async function purgeDeletedFiles(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const rows = await prisma.fileAsset.findMany({ where: { deletedAt: { lt: cutoff } }, take: 100 });
  for (const f of rows) {
    await storage().delete(f.storageKey).catch(() => {});
    await prisma.fileAsset.delete({ where: { id: f.id } });
  }
  return rows.length;
}
