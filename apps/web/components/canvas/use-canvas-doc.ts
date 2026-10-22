"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  getObjectsMap,
  getMetaMap,
  readObject,
  writeObject,
  updateObject as yUpdateObject,
  deleteObjects as yDeleteObjects,
  newObjectId,
  objectBounds,
  unionBounds,
  alignObjects,
  distributeObjects,
  autoArrange,
  type CanvasObject,
  type CanvasObjectInput,
  type AlignMode,
  type Bounds,
} from "@collabspace/shared/canvas";

/**
 * React bindings for a canvas Y.Doc:
 *  - `objects`: sorted array derived from the Yjs map (re-renders on any change, local or remote)
 *  - mutation helpers that write with a local origin so the UndoManager only tracks this user
 *  - undo/redo via Y.UndoManager
 */

export interface CanvasOps {
  objects: CanvasObject[];
  byId: Map<string, CanvasObject>;
  add: (obj: Omit<CanvasObjectInput, "id"> & { id?: string }) => CanvasObject;
  update: (id: string, patch: Partial<CanvasObjectInput>) => void;
  updateMany: (patches: Array<{ id: string; patch: Partial<CanvasObjectInput> }>) => void;
  remove: (ids: string[]) => void;
  duplicate: (ids: string[], offset?: number) => string[];
  paste: (objs: CanvasObject[], at?: { x: number; y: number }) => string[];
  group: (ids: string[]) => string | null;
  ungroup: (ids: string[]) => void;
  reorder: (ids: string[], dir: "forward" | "backward" | "front" | "back") => void;
  setLocked: (ids: string[], locked: boolean) => void;
  align: (ids: string[], mode: AlignMode) => void;
  distribute: (ids: string[], axis: "x" | "y") => void;
  arrange: (ids: string[]) => void;
  boundsOf: (ids: string[]) => Bounds | null;
  lookupBounds: (id: string) => Bounds | null;
  childrenOf: (frameId: string) => CanvasObject[];
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  transact: (fn: () => void) => void;
}

export function useCanvasDoc(doc: Y.Doc | null | undefined, origin: string, readOnly = false): CanvasOps {
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const localOrigin = useMemo(() => ({ origin }), [origin]);

  useEffect(() => {
    if (!doc) return;
    const map = getObjectsMap(doc);
    const refresh = () => {
      const out: CanvasObject[] = [];
      map.forEach((m) => {
        const o = readObject(m);
        if (o) out.push(o);
      });
      out.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
      setObjects(out);
    };
    refresh();
    map.observeDeep(refresh);
    const um = new Y.UndoManager([map, getMetaMap(doc)], { trackedOrigins: new Set([localOrigin]), captureTimeout: 300 });
    const onStack = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };
    um.on("stack-item-added", onStack);
    um.on("stack-item-popped", onStack);
    um.on("stack-cleared", onStack);
    undoRef.current = um;
    return () => {
      map.unobserveDeep(refresh);
      um.destroy();
      undoRef.current = null;
    };
  }, [doc, localOrigin]);

  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const lookupBounds = useCallback((id: string) => (byId.get(id) ? objectBounds(byId.get(id)!) : null), [byId]);
  const boundsOf = useCallback((ids: string[]) => unionBounds(ids.map((id) => byId.get(id)).filter((o): o is CanvasObject => Boolean(o)).map((o) => objectBounds(o))), [byId]);
  const childrenOf = useCallback((frameId: string) => objects.filter((o) => o.parentId === frameId), [objects]);
  const guard = <T,>(fn: () => T, fallback: T): T => (!doc || readOnly ? fallback : fn());
  const transact = useCallback((fn: () => void) => doc?.transact(fn, localOrigin), [doc, localOrigin]);
  const maxZ = () => objects.reduce((m, o) => Math.max(m, o.zIndex), 0);

  const add: CanvasOps["add"] = (obj) =>
    guard(() => {
      const full = writeObject(doc!, { ...obj, id: obj.id ?? newObjectId(), zIndex: obj.zIndex ?? maxZ() + 1, createdAt: Date.now(), createdBy: origin }, localOrigin);
      return full;
    }, obj as CanvasObject);
  const update: CanvasOps["update"] = (id, patch) => guard(() => yUpdateObject(doc!, id, patch, localOrigin), undefined);
  const updateMany: CanvasOps["updateMany"] = (patches) => guard(() => doc!.transact(() => patches.forEach((p) => yUpdateObject(doc!, p.id, p.patch)), localOrigin), undefined);
  const remove: CanvasOps["remove"] = (ids) =>
    guard(() => {
      // Deleting a frame also deletes its children; locked objects are skipped.
      const all = new Set<string>();
      for (const id of ids) {
        const o = byId.get(id);
        if (!o || o.locked) continue;
        all.add(id);
        if (o.type === "frame") childrenOf(id).forEach((c) => all.add(c.id));
      }
      yDeleteObjects(doc!, [...all], localOrigin);
    }, undefined);

  const paste: CanvasOps["paste"] = (objs, at) =>
    guard(() => {
      if (!objs.length) return [];
      const idMap = new Map(objs.map((o) => [o.id, newObjectId()]));
      const b = unionBounds(objs.map((o) => objectBounds(o)));
      const dx = at && b ? at.x - b.x : 24;
      const dy = at && b ? at.y - b.y : 24;
      let z = maxZ() + 1;
      const ids: string[] = [];
      doc!.transact(() => {
        for (const o of objs) {
          const id = idMap.get(o.id)!;
          const remap = (end: CanvasObject["from"]) => (end && "objectId" in end ? (idMap.has(end.objectId) ? { ...end, objectId: idMap.get(end.objectId)! } : null) : end);
          writeObject(doc!, { ...o, id, x: o.x + dx, y: o.y + dy, zIndex: z++, parentId: o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : null, groupId: o.groupId ? `${o.groupId}-copy` : null, from: remap(o.from), to: remap(o.to), threadId: null, createdAt: Date.now(), createdBy: origin });
          ids.push(id);
        }
      }, localOrigin);
      return ids;
    }, []);
  const duplicate: CanvasOps["duplicate"] = (ids, offset = 24) => {
    const objs = ids.map((id) => byId.get(id)).filter((o): o is CanvasObject => Boolean(o));
    const b = unionBounds(objs.map((o) => objectBounds(o)));
    return paste(objs, b ? { x: b.x + offset, y: b.y + offset } : undefined);
  };
  const group: CanvasOps["group"] = (ids) =>
    guard(() => {
      if (ids.length < 2) return null;
      const gid = newObjectId();
      updateMany(ids.map((id) => ({ id, patch: { groupId: gid } })));
      return gid;
    }, null);
  const ungroup: CanvasOps["ungroup"] = (ids) => updateMany(ids.map((id) => ({ id, patch: { groupId: null } })));
  const reorder: CanvasOps["reorder"] = (ids, dir) =>
    guard(() => {
      const sorted = [...objects];
      const set = new Set(ids);
      if (dir === "front") {
        let z = maxZ() + 1;
        updateMany(sorted.filter((o) => set.has(o.id)).map((o) => ({ id: o.id, patch: { zIndex: z++ } })));
      } else if (dir === "back") {
        const min = sorted.reduce((m, o) => Math.min(m, o.zIndex), 0);
        let z = min - ids.length;
        updateMany(sorted.filter((o) => set.has(o.id)).map((o) => ({ id: o.id, patch: { zIndex: z++ } })));
      } else {
        const patches: Array<{ id: string; patch: Partial<CanvasObjectInput> }> = [];
        for (const o of sorted.filter((o) => set.has(o.id))) {
          const idx = sorted.indexOf(o);
          const neighbor = dir === "forward" ? sorted.slice(idx + 1).find((n) => !set.has(n.id) && n.type !== "frame") : [...sorted.slice(0, idx)].reverse().find((n) => !set.has(n.id) && n.type !== "frame");
          if (!neighbor) continue;
          patches.push({ id: o.id, patch: { zIndex: neighbor.zIndex } });
          patches.push({ id: neighbor.id, patch: { zIndex: o.zIndex } });
        }
        updateMany(patches);
      }
    }, undefined);
  const setLocked: CanvasOps["setLocked"] = (ids, locked) => guard(() => doc!.transact(() => ids.forEach((id) => yUpdateObject(doc!, id, { locked })), localOrigin), undefined);
  const align: CanvasOps["align"] = (ids, mode) => {
    const objs = ids.map((id) => byId.get(id)).filter((o): o is CanvasObject => Boolean(o) && !o.locked);
    updateMany(alignObjects(objs, mode).map((r) => ({ id: r.id, patch: { x: r.x, y: r.y } })));
  };
  const distribute: CanvasOps["distribute"] = (ids, axis) => {
    const objs = ids.map((id) => byId.get(id)).filter((o): o is CanvasObject => Boolean(o) && !o.locked);
    updateMany(distributeObjects(objs, axis).map((r) => ({ id: r.id, patch: { x: r.x, y: r.y } })));
  };
  const arrange: CanvasOps["arrange"] = (ids) => {
    const objs = ids.map((id) => byId.get(id)).filter((o): o is CanvasObject => Boolean(o) && !o.locked && o.type !== "connector");
    const b = unionBounds(objs.map((o) => objectBounds(o)));
    if (!b) return;
    updateMany(autoArrange(objs, { x: b.x, y: b.y }).map((r) => ({ id: r.id, patch: { x: r.x, y: r.y } })));
  };

  return {
    objects,
    byId,
    add,
    update,
    updateMany,
    remove,
    duplicate,
    paste,
    group,
    ungroup,
    reorder,
    setLocked,
    align,
    distribute,
    arrange,
    boundsOf,
    lookupBounds,
    childrenOf,
    undo: () => undoRef.current?.undo(),
    redo: () => undoRef.current?.redo(),
    canUndo,
    canRedo,
    transact,
  };
}
