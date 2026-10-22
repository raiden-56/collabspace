import { z } from "zod";
import * as Y from "yjs";

/**
 * Canvas object model.
 *
 * Yjs layout for a canvas room:
 *   doc.getMap("objects")  : Y.Map<Y.Map<unknown>>  — keyed by object id, each a flat Y.Map of props
 *   doc.getMap("meta")     : Y.Map<unknown>          — canvas settings (grid, background, etc.)
 *
 * Objects are flat property maps so concurrent property edits merge per-key.
 */

export const CANVAS_SCHEMA_VERSION = 1;

export const CanvasObjectType = z.enum([
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "line",
  "connector",
  "freehand",
  "image",
  "file",
  "comment",
  "embed",
  "task",
  "document",
  "frame",
  "node",
]);
export type CanvasObjectType = z.infer<typeof CanvasObjectType>;

export const AnchorSide = z.enum(["top", "right", "bottom", "left", "center"]);
export type AnchorSide = z.infer<typeof AnchorSide>;

export const ConnectorEnd = z.union([
  z.object({ objectId: z.string(), side: AnchorSide }),
  z.object({ x: z.number(), y: z.number() }),
]);
export type ConnectorEnd = z.infer<typeof ConnectorEnd>;

export const STICKY_COLORS = [
  "#FFE66D", "#FFB8A2", "#B5EAD7", "#C7CEEA", "#F8C8DC", "#FDE2B3", "#D6F0FF", "#E6E6E6",
] as const;

const base = {
  id: z.string().min(1),
  type: CanvasObjectType,
  x: z.number(),
  y: z.number(),
  width: z.number().min(0).default(0),
  height: z.number().min(0).default(0),
  rotation: z.number().default(0),
  zIndex: z.number().default(0),
  locked: z.boolean().default(false),
  /** Frame/section this object belongs to */
  parentId: z.string().nullable().default(null),
  /** Group identifier for group/ungroup */
  groupId: z.string().nullable().default(null),
  opacity: z.number().min(0).max(1).default(1),
  createdBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
};

const textProps = {
  text: z.string().default(""),
  fontSize: z.number().default(16),
  fontWeight: z.enum(["normal", "bold"]).default("normal"),
  fontStyle: z.enum(["normal", "italic"]).default("normal"),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  textColor: z.string().default("#1F2430"),
};

const shapeProps = {
  fill: z.string().default("#FFFFFF"),
  stroke: z.string().default("#5B8CFF"),
  strokeWidth: z.number().default(2),
  cornerRadius: z.number().default(8),
};

export const CanvasObject = z.object({
  ...base,
  ...textProps,
  ...shapeProps,
  // sticky
  color: z.string().default(STICKY_COLORS[0]),
  tags: z.array(z.string()).default([]),
  reactions: z.record(z.string(), z.array(z.string())).default({}),
  // line / connector
  points: z.array(z.number()).default([]),
  from: ConnectorEnd.nullable().default(null),
  to: ConnectorEnd.nullable().default(null),
  arrowStart: z.boolean().default(false),
  arrowEnd: z.boolean().default(true),
  lineStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
  label: z.string().default(""),
  // image / file / embed
  src: z.string().nullable().default(null),
  fileId: z.string().nullable().default(null),
  fileName: z.string().nullable().default(null),
  mimeType: z.string().nullable().default(null),
  alt: z.string().default(""),
  url: z.string().nullable().default(null),
  embedTitle: z.string().nullable().default(null),
  // task / document cards
  taskId: z.string().nullable().default(null),
  documentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  // frame
  title: z.string().default(""),
  collapsed: z.boolean().default(false),
  // comment pin
  threadId: z.string().nullable().default(null),
  // node (diagram)
  nodeShape: z.enum(["rect", "rounded", "ellipse", "diamond", "parallelogram", "cylinder"]).default("rounded"),
});
export type CanvasObject = z.infer<typeof CanvasObject>;
export type CanvasObjectInput = z.input<typeof CanvasObject>;

export const CanvasMeta = z.object({
  schemaVersion: z.number().default(CANVAS_SCHEMA_VERSION),
  background: z.string().default("#F7F8FC"),
  grid: z.boolean().default(true),
  gridSize: z.number().default(20),
  snapToGrid: z.boolean().default(false),
});
export type CanvasMeta = z.infer<typeof CanvasMeta>;

export const CanvasSnapshot = z.object({
  schemaVersion: z.number(),
  meta: CanvasMeta,
  objects: z.array(CanvasObject),
});
export type CanvasSnapshot = z.infer<typeof CanvasSnapshot>;

/** Keys that can be omitted from Yjs maps if they equal the schema default (keeps updates small) */
export function objectDefaults(type: CanvasObjectType): CanvasObject {
  return CanvasObject.parse({ id: "_", type, x: 0, y: 0 });
}

export function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("objects") as Y.Map<Y.Map<unknown>>;
}
export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}

export function readObject(ymap: Y.Map<unknown>): CanvasObject | null {
  const raw: Record<string, unknown> = {};
  ymap.forEach((v, k) => {
    raw[k] = v;
  });
  const parsed = CanvasObject.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function writeObject(doc: Y.Doc, obj: CanvasObjectInput, origin?: unknown): CanvasObject {
  const full = CanvasObject.parse(obj);
  const objects = getObjectsMap(doc);
  doc.transact(() => {
    let ymap = objects.get(full.id);
    if (!ymap) {
      ymap = new Y.Map<unknown>();
      objects.set(full.id, ymap);
    }
    const defaults = objectDefaults(full.type);
    for (const [k, v] of Object.entries(full)) {
      // Always write identity & geometry; skip defaults for everything else to keep docs small.
      const always = k === "id" || k === "type" || k === "x" || k === "y" || k === "width" || k === "height";
      if (always || !deepEqual(v, (defaults as Record<string, unknown>)[k])) ymap.set(k, v);
      else if (ymap.has(k)) ymap.delete(k);
    }
  }, origin);
  return full;
}

export function updateObject(doc: Y.Doc, id: string, patch: Partial<CanvasObjectInput>, origin?: unknown): void {
  const objects = getObjectsMap(doc);
  const ymap = objects.get(id);
  if (!ymap) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id" || k === "type") continue;
      if (v === undefined) continue;
      ymap.set(k, v);
    }
    ymap.set("updatedAt", Date.now());
  }, origin);
}

export function deleteObjects(doc: Y.Doc, ids: string[], origin?: unknown): void {
  const objects = getObjectsMap(doc);
  doc.transact(() => {
    for (const id of ids) {
      objects.delete(id);
      // Detach connectors pointing to removed objects — keep them as free-floating lines.
      objects.forEach((m) => {
        if (m.get("type") !== "connector") return;
        for (const endKey of ["from", "to"] as const) {
          const end = m.get(endKey) as ConnectorEnd | null;
          if (end && "objectId" in end && end.objectId === id) {
            const anchor = m.get(`_${endKey}Cache`) as { x: number; y: number } | undefined;
            m.set(endKey, anchor ?? { x: Number(m.get("x") ?? 0), y: Number(m.get("y") ?? 0) });
          }
        }
      });
    }
  }, origin);
}

export function serializeCanvas(doc: Y.Doc): CanvasSnapshot {
  const objects: CanvasObject[] = [];
  getObjectsMap(doc).forEach((m) => {
    const o = readObject(m);
    if (o) objects.push(o);
  });
  objects.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const metaRaw: Record<string, unknown> = {};
  getMetaMap(doc).forEach((v, k) => {
    metaRaw[k] = v;
  });
  const metaParsed = CanvasMeta.safeParse(metaRaw);
  const meta = metaParsed.success ? metaParsed.data : CanvasMeta.parse({});
  return { schemaVersion: CANVAS_SCHEMA_VERSION, meta, objects };
}

/** Replace the full canvas content with a snapshot (used by templates and version restore). */
export function applySnapshot(doc: Y.Doc, snapshot: CanvasSnapshot, origin?: unknown): void {
  const parsed = CanvasSnapshot.parse(snapshot);
  doc.transact(() => {
    const objects = getObjectsMap(doc);
    const keep = new Set(parsed.objects.map((o) => o.id));
    const toDelete: string[] = [];
    objects.forEach((_, k) => {
      if (!keep.has(k)) toDelete.push(k);
    });
    for (const k of toDelete) objects.delete(k);
    for (const o of parsed.objects) writeObject(doc, o, origin);
    const meta = getMetaMap(doc);
    for (const [k, v] of Object.entries(parsed.meta)) meta.set(k, v);
  }, origin);
}

/** Plain text used for search indexing and AI summaries. */
export function canvasText(snapshot: CanvasSnapshot): string {
  const parts: string[] = [];
  for (const o of snapshot.objects) {
    if (o.title) parts.push(o.title);
    if (o.text) parts.push(o.text);
    if (o.label) parts.push(o.label);
    if (o.fileName) parts.push(o.fileName);
    if (o.embedTitle) parts.push(o.embedTitle);
    if (o.tags.length) parts.push(o.tags.join(" "));
  }
  return parts.join("\n").trim();
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function objectBounds(o: Pick<CanvasObject, "x" | "y" | "width" | "height" | "points" | "type">): Bounds {
  if ((o.type === "freehand" || o.type === "line") && o.points.length >= 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < o.points.length; i += 2) {
      const px = o.x + (o.points[i] ?? 0);
      const py = o.y + (o.points[i + 1] ?? 0);
      minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function anchorPoint(b: Bounds, side: AnchorSide): { x: number; y: number } {
  switch (side) {
    case "top": return { x: b.x + b.width / 2, y: b.y };
    case "bottom": return { x: b.x + b.width / 2, y: b.y + b.height };
    case "left": return { x: b.x, y: b.y + b.height / 2 };
    case "right": return { x: b.x + b.width, y: b.y + b.height / 2 };
    default: return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
}

/** Choose the best anchor sides for a connector between two bounds. */
export function autoAnchors(a: Bounds, b: Bounds): { from: AnchorSide; to: AnchorSide } {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  return dy > 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

export function resolveConnectorEnd(end: ConnectorEnd | null, lookup: (id: string) => Bounds | null): { x: number; y: number } | null {
  if (!end) return null;
  if ("objectId" in end) {
    const b = lookup(end.objectId);
    if (!b) return null;
    return anchorPoint(b, end.side);
  }
  return { x: end.x, y: end.y };
}

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

export function alignObjects(objs: CanvasObject[], mode: AlignMode): Array<{ id: string; x: number; y: number }> {
  const bounds = objs.map((o) => ({ o, b: objectBounds(o) }));
  const u = unionBounds(bounds.map((x) => x.b));
  if (!u) return [];
  return bounds.map(({ o, b }) => {
    let x = o.x, y = o.y;
    switch (mode) {
      case "left": x = o.x + (u.x - b.x); break;
      case "right": x = o.x + (u.x + u.width - (b.x + b.width)); break;
      case "centerX": x = o.x + (u.x + u.width / 2 - (b.x + b.width / 2)); break;
      case "top": y = o.y + (u.y - b.y); break;
      case "bottom": y = o.y + (u.y + u.height - (b.y + b.height)); break;
      case "centerY": y = o.y + (u.y + u.height / 2 - (b.y + b.height / 2)); break;
    }
    return { id: o.id, x, y };
  });
}

export function distributeObjects(objs: CanvasObject[], axis: "x" | "y"): Array<{ id: string; x: number; y: number }> {
  if (objs.length < 3) return objs.map((o) => ({ id: o.id, x: o.x, y: o.y }));
  const items = objs.map((o) => ({ o, b: objectBounds(o) })).sort((p, q) => (axis === "x" ? p.b.x - q.b.x : p.b.y - q.b.y));
  const first = items[0]!, last = items[items.length - 1]!;
  const total = axis === "x" ? last.b.x + last.b.width - first.b.x : last.b.y + last.b.height - first.b.y;
  const sizes = items.reduce((s, it) => s + (axis === "x" ? it.b.width : it.b.height), 0);
  const gap = (total - sizes) / (items.length - 1);
  let cursor = axis === "x" ? first.b.x : first.b.y;
  return items.map(({ o, b }) => {
    const res = { id: o.id, x: o.x, y: o.y };
    if (axis === "x") { res.x = o.x + (cursor - b.x); cursor += b.width + gap; }
    else { res.y = o.y + (cursor - b.y); cursor += b.height + gap; }
    return res;
  });
}

/** Grid auto-arrange: lays out objects in rows, preserving their sizes. */
export function autoArrange(objs: CanvasObject[], origin: { x: number; y: number }, gap = 24): Array<{ id: string; x: number; y: number }> {
  const sorted = [...objs].sort((a, b) => a.y - b.y || a.x - b.x);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const colWidth = Math.max(...sorted.map((o) => objectBounds(o).width), 1);
  const rowHeight = Math.max(...sorted.map((o) => objectBounds(o).height), 1);
  return sorted.map((o, i) => ({
    id: o.id,
    x: origin.x + (i % cols) * (colWidth + gap),
    y: origin.y + Math.floor(i / cols) * (rowHeight + gap),
  }));
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export function newObjectId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
