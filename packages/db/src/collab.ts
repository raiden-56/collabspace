import * as Y from "yjs";
import { prisma } from "./index.js";
import type { ResourceType, VersionKind } from "@prisma/client";
import { canvas as canvasLib, collabKey } from "@collabspace/shared";
import { documentPlainText } from "@collabspace/shared/editor";

/**
 * Yjs persistence primitives shared by the API (templates, versions, restore) and the sync service
 * (live updates). Layout:
 *   CollabDoc(key)   — compacted full state (encoded Yjs update)
 *   CollabUpdate     — incremental updates appended since the last compaction
 * loadDoc() returns state + pending updates merged into one Y.Doc.
 */

export type CollabType = "canvas" | "document";

export const COMPACT_THRESHOLD = 200;
export const AUTO_VERSION_INTERVAL_MS = 10 * 60_000;
export const AUTO_VERSION_RETENTION = 50;

export function keyFor(type: CollabType, id: string): string {
  return collabKey(type, id);
}

export function resourceTypeFor(type: CollabType): ResourceType {
  return type === "canvas" ? "CANVAS" : "DOCUMENT";
}

export async function loadDoc(type: CollabType, id: string): Promise<Y.Doc> {
  const key = keyFor(type, id);
  const doc = new Y.Doc({ gc: true });
  const row = await prisma.collabDoc.findUnique({ where: { key }, include: { updates: { orderBy: { id: "asc" } } } });
  if (!row) return doc;
  if (row.state.length) Y.applyUpdate(doc, new Uint8Array(row.state));
  for (const u of row.updates) Y.applyUpdate(doc, new Uint8Array(u.update));
  return doc;
}

export async function ensureDocRow(type: CollabType, id: string): Promise<void> {
  const key = keyFor(type, id);
  await prisma.collabDoc.upsert({ where: { key }, update: {}, create: { key, resourceType: resourceTypeFor(type), resourceId: id, state: Buffer.alloc(0) } });
}

export async function saveFullState(type: CollabType, id: string, doc: Y.Doc): Promise<void> {
  const key = keyFor(type, id);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.$transaction([
    prisma.collabDoc.upsert({
      where: { key },
      update: { state, updateCount: 0, version: { increment: 1 } },
      create: { key, resourceType: resourceTypeFor(type), resourceId: id, state },
    }),
    prisma.collabUpdate.deleteMany({ where: { docKey: key } }),
  ]);
  await refreshDerived(type, id, doc);
}

/** Append an incremental update. Compacts automatically when the threshold is reached. */
export async function appendUpdate(type: CollabType, id: string, update: Uint8Array, authorId?: string | null): Promise<void> {
  const key = keyFor(type, id);
  await ensureDocRow(type, id);
  const row = await prisma.collabDoc.update({
    where: { key },
    data: { updateCount: { increment: 1 }, updates: { create: { update: Buffer.from(update), authorId: authorId ?? null } } },
    select: { updateCount: true },
  });
  if (row.updateCount >= COMPACT_THRESHOLD) await compact(type, id);
}

export async function compact(type: CollabType, id: string): Promise<void> {
  const doc = await loadDoc(type, id);
  await saveFullState(type, id, doc);
}

/** Refresh search text + updatedAt on the owning resource. */
export async function refreshDerived(type: CollabType, id: string, doc: Y.Doc): Promise<void> {
  if (type === "canvas") {
    const snap = canvasLib.serializeCanvas(doc);
    await prisma.canvas.updateMany({ where: { id }, data: { contentText: canvasLib.canvasText(snap).slice(0, 100_000), updatedAt: new Date() } });
  } else {
    await prisma.document.updateMany({ where: { id }, data: { contentText: documentPlainText(doc).slice(0, 200_000), updatedAt: new Date() } });
  }
}

export interface VersionSummary {
  id: string;
  kind: VersionKind;
  name: string | null;
  authorId: string | null;
  author?: { id: string; name: string; avatarUrl: string | null } | null;
  sizeBytes: number;
  createdAt: Date;
  objectCount?: number;
  preview?: string;
}

export async function createVersion(type: CollabType, id: string, kind: VersionKind, opts: { name?: string | null; authorId?: string | null; doc?: Y.Doc } = {}): Promise<VersionSummary> {
  const doc = opts.doc ?? (await loadDoc(type, id));
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
  if (type === "canvas") {
    const snap = canvasLib.serializeCanvas(doc);
    const v = await prisma.canvasVersion.create({
      data: { canvasId: id, kind, name: opts.name ?? null, authorId: opts.authorId ?? null, snapshot, sizeBytes: snapshot.length, objectCount: snap.objects.length },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await pruneAutoVersions(type, id);
    return { ...v, preview: canvasLib.canvasText(snap).slice(0, 200) };
  }
  const text = documentPlainText(doc);
  const v = await prisma.documentVersion.create({
    data: { documentId: id, kind, name: opts.name ?? null, authorId: opts.authorId ?? null, snapshot, sizeBytes: snapshot.length, contentText: text.slice(0, 50_000) },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
  await pruneAutoVersions(type, id);
  return { ...v, preview: text.slice(0, 200) };
}

async function pruneAutoVersions(type: CollabType, id: string): Promise<void> {
  if (type === "canvas") {
    const old = await prisma.canvasVersion.findMany({ where: { canvasId: id, kind: "AUTO" }, orderBy: { createdAt: "desc" }, skip: AUTO_VERSION_RETENTION, select: { id: true } });
    if (old.length) await prisma.canvasVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  } else {
    const old = await prisma.documentVersion.findMany({ where: { documentId: id, kind: "AUTO" }, orderBy: { createdAt: "desc" }, skip: AUTO_VERSION_RETENTION, select: { id: true } });
    if (old.length) await prisma.documentVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
}

/** Create an AUTO checkpoint if the most recent version is older than the interval. */
export async function maybeAutoVersion(type: CollabType, id: string, doc: Y.Doc, authorId?: string | null): Promise<boolean> {
  const since = new Date(Date.now() - AUTO_VERSION_INTERVAL_MS);
  const recent =
    type === "canvas"
      ? await prisma.canvasVersion.findFirst({ where: { canvasId: id, createdAt: { gte: since } }, select: { id: true } })
      : await prisma.documentVersion.findFirst({ where: { documentId: id, createdAt: { gte: since } }, select: { id: true } });
  if (recent) return false;
  await createVersion(type, id, "AUTO", { authorId, doc });
  return true;
}

export async function listVersions(type: CollabType, id: string): Promise<VersionSummary[]> {
  if (type === "canvas") {
    return prisma.canvasVersion.findMany({
      where: { canvasId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, kind: true, name: true, authorId: true, sizeBytes: true, createdAt: true, objectCount: true, author: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }
  const rows = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, kind: true, name: true, authorId: true, sizeBytes: true, createdAt: true, contentText: true, author: { select: { id: true, name: true, avatarUrl: true } } },
  });
  return rows.map(({ contentText, ...r }) => ({ ...r, preview: contentText.slice(0, 200) }));
}

export async function loadVersionDoc(type: CollabType, id: string, versionId: string): Promise<Y.Doc | null> {
  const row =
    type === "canvas"
      ? await prisma.canvasVersion.findFirst({ where: { id: versionId, canvasId: id } })
      : await prisma.documentVersion.findFirst({ where: { id: versionId, documentId: id } });
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.snapshot));
  return doc;
}
