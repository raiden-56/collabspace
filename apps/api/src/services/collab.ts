import * as Y from "yjs";
import { canvas as canvasLib } from "@collabspace/shared";
import { tiptapJsonToYDoc } from "@collabspace/shared/editor";
import {
  loadDoc,
  saveFullState,
  createVersion,
  listVersions,
  loadVersionDoc as loadVersionDocOrNull,
  type CollabType,
  type VersionSummary,
} from "@collabspace/db/collab";
import { recordActivity } from "../lib/activity.js";
import { notFound } from "../lib/errors.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

export { loadDoc, saveFullState, createVersion, listVersions, appendUpdate, compact, maybeAutoVersion, refreshDerived, keyFor } from "@collabspace/db/collab";
export type { CollabType, VersionSummary } from "@collabspace/db/collab";

export async function loadVersionDoc(type: CollabType, id: string, versionId: string): Promise<Y.Doc> {
  const doc = await loadVersionDocOrNull(type, id, versionId);
  if (!doc) throw notFound("Version");
  return doc;
}

/**
 * Restore a version without destroying history:
 *  1. snapshot the current live state as PRE_RESTORE
 *  2. apply the old content *into the live Yjs document* as a new transaction so connected
 *     clients converge instead of forking, persist it, and push the diff to the sync service
 *  3. record a RESTORE version pointing at the result
 */
export async function restoreVersion(type: CollabType, id: string, versionId: string, actorId: string, workspaceId: string, projectId: string | null, title: string): Promise<{ update: Uint8Array; version: VersionSummary }> {
  const live = await loadDoc(type, id);
  const target = await loadVersionDoc(type, id, versionId);
  await createVersion(type, id, "PRE_RESTORE", { name: "Before restore", authorId: actorId, doc: live });

  const before = Y.encodeStateVector(live);
  if (type === "canvas") {
    canvasLib.applySnapshot(live, canvasLib.serializeCanvas(target), "restore");
  } else {
    const liveFrag = live.getXmlFragment("default");
    const targetFrag = target.getXmlFragment("default");
    live.transact(() => {
      liveFrag.delete(0, liveFrag.length);
      const cloned = targetFrag.toArray().map((n) => n.clone());
      liveFrag.insert(0, cloned as Y.XmlElement[]);
    }, "restore");
  }
  const update = Y.encodeStateAsUpdate(live, before);
  await saveFullState(type, id, live);
  const version = await createVersion(type, id, "RESTORE", { name: "Restored version", authorId: actorId, doc: live });
  await pushUpdateToSync(type, id, update);
  await recordActivity({
    workspaceId,
    projectId,
    actorId,
    type: `${type}.restored`,
    resourceType: type === "canvas" ? "CANVAS" : "DOCUMENT",
    resourceId: id,
    resourceTitle: title,
    payload: { versionId },
  });
  return { update, version };
}

/** Ask the sync service to apply an update to the live room (if loaded) so connected clients converge. */
export async function pushUpdateToSync(type: CollabType, id: string, update: Uint8Array): Promise<void> {
  try {
    const res = await fetch(`${config.SYNC_URL}/internal/yjs/apply`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": config.INTERNAL_EVENT_SECRET },
      body: JSON.stringify({ type, id, update: Buffer.from(update).toString("base64") }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) logger.warn({ status: res.status }, "sync service rejected yjs apply");
  } catch (err) {
    if (!config.isTest) logger.debug({ err: (err as Error).message }, "sync service unreachable for yjs apply");
  }
}

// ---- Seeding --------------------------------------------------------------------

export async function seedCanvasFromTemplate(canvasId: string, templateKey: string | undefined, createdBy: string): Promise<void> {
  const doc = new Y.Doc();
  if (templateKey) {
    const { buildCanvasTemplate } = await import("@collabspace/shared");
    const snap = buildCanvasTemplate(templateKey, canvasId.slice(-6));
    if (snap) {
      snap.objects = snap.objects.map((o) => ({ ...o, createdBy }));
      canvasLib.applySnapshot(doc, snap, "template");
    }
  }
  canvasLib.getMetaMap(doc).set("schemaVersion", canvasLib.CANVAS_SCHEMA_VERSION);
  await saveFullState("canvas", canvasId, doc);
}

export async function seedDocumentContent(documentId: string, content: Record<string, unknown> | undefined): Promise<void> {
  const doc = content ? tiptapJsonToYDoc(content) : new Y.Doc();
  if (!content) doc.getXmlFragment("default");
  await saveFullState("document", documentId, doc);
}
