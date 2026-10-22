"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Rect, Transformer, Line } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, History, MessageSquare, Play, SlidersHorizontal, X, Layers } from "lucide-react";
import { objectBounds, unionBounds, autoAnchors, snap as snapTo, STICKY_COLORS, type CanvasObject, type CanvasObjectInput } from "@collabspace/shared/canvas";
import { post, uploadFile, errorMessage, type TaskDto, type DocumentDto } from "@/lib/api";
import { useCanvas } from "@/lib/queries";
import { useCollab, useAwareness } from "@/lib/yjs";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useHeader } from "@/lib/stores/header-store";
import { useApp } from "@/components/app-shell/workspace-context";
import { DocSyncStatus } from "@/components/app-shell/connection-status";
import { useCanvasStore, zoomAt, fitBounds, screenToCanvas, canvasToScreen, GRID, MIN_SCALE, MAX_SCALE, type Tool } from "./canvas-store";
import { useCanvasDoc } from "./use-canvas-doc";
import { CanvasObjectNode, ConnectorNode, type ResolvedLink } from "./canvas-objects";
import { CanvasToolbar, CanvasZoomBar } from "./canvas-toolbar";
import { PropertyPanel, typeLabel } from "./canvas-property-panel";
import { Minimap } from "./canvas-minimap";
import { TaskPickerDialog, DocumentPickerDialog, EmbedDialog, ConvertToTaskDialog } from "./canvas-pickers";
import { CommentThreads } from "@/components/comments/comment-thread";
import { VersionHistoryPanel } from "@/components/shared/version-history";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/skeleton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuLabel, Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const DEFAULTS: Record<string, Partial<CanvasObjectInput>> = {
  sticky: { width: 180, height: 120 },
  text: { width: 240, height: 40, textAlign: "left" },
  rect: { width: 160, height: 100 },
  ellipse: { width: 140, height: 140 },
  diamond: { width: 160, height: 120 },
  frame: { width: 600, height: 400, fill: "#EEF1F8", stroke: "#CBD2E1", zIndex: -10 },
  node: { width: 180, height: 72 },
  task: { width: 220, height: 110 },
  document: { width: 220, height: 90 },
  embed: { width: 260, height: 90 },
  file: { width: 240, height: 64 },
  image: { width: 320, height: 240 },
  comment: { width: 28, height: 28 },
};

export function CanvasEditor({ canvasId, shareToken, readOnly: forcedReadOnly }: { canvasId: string; shareToken?: string | null; readOnly?: boolean }) {
  const { user, workspaceSlug } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const canvas = useCanvas(canvasId, shareToken);
  const access = canvas.data?.access;
  const readOnly = forcedReadOnly || !(access === "OWNER" || access === "EDITOR");
  const canComment = access === "OWNER" || access === "EDITOR" || access === "COMMENTER";
  const collab = useCollab("canvas", canvasId, { shareToken, user: user ? { userId: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl } : null, enabled: Boolean(canvas.data) });
  const doc = collab.conn?.doc ?? null;
  const ops = useCanvasDoc(doc, user?.id ?? "anon", readOnly);
  const awareness = collab.conn?.awareness ?? null;
  const others = useAwareness(awareness);

  const store = useCanvasStore();
  const { tool, selectedIds, editingId, viewport, showGrid, snapToGrid, rightPanel, presentationIndex } = store;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [boxSel, setBoxSel] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [draft, setDraft] = useState<{ type: Tool; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [drawing, setDrawing] = useState<number[] | null>(null);
  const [panning, setPanning] = useState(false);
  const [picker, setPicker] = useState<{ kind: "task" | "document" | "embed"; at: { x: number; y: number } } | null>(null);
  const [convert, setConvert] = useState<CanvasObject | null>(null);
  const [ctxTarget, setCtxTarget] = useState<CanvasObject | null>(null);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageAt = useRef<{ x: number; y: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const dragOrigin = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const lastCursorSent = useRef(0);

  const selected = useMemo(() => selectedIds.map((id) => ops.byId.get(id)).filter((o): o is CanvasObject => Boolean(o)), [selectedIds, ops.byId]);
  const frames = useMemo(() => ops.objects.filter((o) => o.type === "frame"), [ops.objects]);
  const connectors = useMemo(() => ops.objects.filter((o) => o.type === "connector"), [ops.objects]);
  const shapes = useMemo(() => ops.objects.filter((o) => o.type !== "connector" && o.type !== "frame"), [ops.objects]);

  // Header
  useHeader(
    {
      title: canvas.data?.title ?? "Canvas",
      breadcrumbs: canvas.data && workspaceSlug ? [{ label: "Canvases", href: `/app/${workspaceSlug}/canvases` }, ...(canvas.data.project ? [{ label: canvas.data.project.name, href: `/app/${workspaceSlug}/projects/${canvas.data.project.id}` }] : [])] : [],
      resource: canvas.data ? { type: "CANVAS", id: canvasId, access } : null,
      status: <DocSyncStatus status={collab.status} synced={collab.synced} />,
      actions: (
        <>
          <Tooltip content="Comments">
            <Button variant={rightPanel === "comments" ? "subtle" : "ghost"} size="icon-sm" aria-label="Comments" onClick={() => store.setRightPanel(rightPanel === "comments" ? null : "comments")}>
              <MessageSquare />
            </Button>
          </Tooltip>
          <Tooltip content="Sections">
            <Button variant={rightPanel === "sections" ? "subtle" : "ghost"} size="icon-sm" aria-label="Sections" onClick={() => store.setRightPanel(rightPanel === "sections" ? null : "sections")}>
              <Layers />
            </Button>
          </Tooltip>
          <Tooltip content="Version history">
            <Button variant={rightPanel === "versions" ? "subtle" : "ghost"} size="icon-sm" aria-label="Version history" onClick={() => store.setRightPanel(rightPanel === "versions" ? null : "versions")}>
              <History />
            </Button>
          </Tooltip>
        </>
      ),
    },
    [canvas.data?.title, canvas.data?.project?.id, access, collab.status, collab.synced, rightPanel],
  );

  // Reset store on mount/unmount
  useEffect(() => {
    store.reset();
    return () => store.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  // Resize observer
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit on first sync
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !(collab.synced || collab.localReady) || ops.objects.length === 0) return;
    fitted.current = true;
    zoomToFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.synced, collab.localReady, ops.objects.length]);

  // Transformer binding
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = selectedIds.map((id) => stage.findOne(`#${CSS.escape(id)}`)).filter((n): n is Konva.Node => Boolean(n) && !ops.byId.get(n!.id())?.locked && ops.byId.get(n!.id())?.type !== "connector");
    tr.nodes(readOnly || editingId ? [] : nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, ops.byId, readOnly, editingId, ops.objects]);

  // Awareness: selection + cursor
  useEffect(() => {
    awareness?.setLocalStateField("selection", selectedIds);
  }, [awareness, selectedIds]);

  // Resolve task/document cards
  const linkIds = useMemo(() => ({ taskIds: ops.objects.filter((o) => o.taskId).map((o) => o.taskId!), documentIds: ops.objects.filter((o) => o.documentId).map((o) => o.documentId!) }), [ops.objects]);
  const resolvedQuery = useQuery({
    queryKey: ["canvas-links", canvasId, linkIds.taskIds.join(","), linkIds.documentIds.join(",")],
    queryFn: () => post<{ tasks: TaskDto[]; documents: Array<{ id: string; title: string; icon: string | null }> }>(`/canvases/${canvasId}/resolve-links${shareToken ? `?share=${shareToken}` : ""}`, linkIds),
    enabled: linkIds.taskIds.length + linkIds.documentIds.length > 0,
    staleTime: 15_000,
  });
  const resolved: ResolvedLink = useMemo(
    () => ({
      tasks: new Map((resolvedQuery.data?.tasks ?? []).map((t) => [t.id, { key: t.key, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee ? { name: t.assignee.name, color: t.assignee.color } : null, completedAt: t.completedAt }])),
      documents: new Map((resolvedQuery.data?.documents ?? []).map((d) => [d.id, { title: d.title, icon: d.icon }])),
    }),
    [resolvedQuery.data],
  );

  // ---- Viewport helpers -------------------------------------------------------
  const zoomToFit = useCallback(() => {
    const b = unionBounds(ops.objects.filter((o) => o.type !== "connector").map((o) => objectBounds(o)));
    if (!b) return store.setViewport({ x: size.width / 2, y: size.height / 2, scale: 1 });
    store.setViewport(fitBounds(b, size));
  }, [ops.objects, size, store]);
  const zoomToSelection = useCallback(() => {
    const b = ops.boundsOf(selectedIds);
    if (b) store.setViewport(fitBounds(b, size, 120));
  }, [ops, selectedIds, size, store]);
  const zoomBy = (factor: number) => store.setViewport((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, v.scale * factor));
  const pointer = () => {
    const p = stageRef.current?.getPointerPosition();
    return p ? screenToCanvas(p, viewport) : { x: 0, y: 0 };
  };
  const snapIf = (n: number) => (snapToGrid ? snapTo(n, GRID) : Math.round(n));

  // ---- Wheel: pan / zoom --------------------------------------------------------
  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const factor = Math.exp(-e.evt.deltaY * 0.0015);
      store.setViewport((v) => zoomAt(v, pos, v.scale * factor));
    } else {
      store.setViewport((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }));
    }
  };

  // ---- Creation -------------------------------------------------------------------
  const createAt = (type: Tool, at: { x: number; y: number }, extra: Partial<CanvasObjectInput> = {}) => {
    const d = DEFAULTS[type] ?? { width: 120, height: 80 };
    const w = extra.width ?? d.width ?? 120;
    const h = extra.height ?? d.height ?? 80;
    const parent = frames.find((f) => at.x >= f.x && at.x <= f.x + f.width && at.y >= f.y && at.y <= f.y + f.height)?.id ?? null;
    const obj = ops.add({ type: type as CanvasObject["type"], ...d, ...extra, x: snapIf(at.x - (extra.x !== undefined ? 0 : w / 2)), y: snapIf(at.y - (extra.y !== undefined ? 0 : h / 2)), width: w, height: h, parentId: type === "frame" ? null : parent, ...(type === "sticky" ? { color: STICKY_COLORS[Math.floor(Math.random() * 4)] } : {}), ...(type === "frame" ? { title: `Section ${frames.length + 1}` } : {}) });
    store.setSelected([obj.id]);
    if (type === "sticky" || type === "text") store.setEditing(obj.id);
    if (tool !== "freehand") store.setTool("select");
    return obj;
  };

  const onStagePointerDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const isBackground = e.target === stage;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const world = screenToCanvas(pos, viewport);
    const mouse = e.evt as MouseEvent;
    if (editingId) store.setEditing(null);

    if (tool === "hand" || store.spaceDown || mouse.button === 1) {
      setPanning(true);
      panStart.current = { x: pos.x, y: pos.y, vx: viewport.x, vy: viewport.y };
      return;
    }
    if (readOnly && tool !== "select") return;
    if (!isBackground && tool === "select") return;

    switch (tool) {
      case "select":
        if (isBackground) {
          if (!mouse.shiftKey) store.setSelected([]);
          setBoxSel({ x1: world.x, y1: world.y, x2: world.x, y2: world.y });
        }
        return;
      case "sticky":
      case "text":
      case "node":
      case "task":
      case "document":
      case "embed":
      case "image":
      case "file":
      case "comment":
        if (tool === "task" || tool === "document" || tool === "embed") return setPicker({ kind: tool, at: world });
        if (tool === "image" || tool === "file") {
          pendingImageAt.current = world;
          fileInputRef.current?.click();
          return;
        }
        if (tool === "comment") return void createCommentPin(world);
        createAt(tool, world);
        return;
      case "rect":
      case "ellipse":
      case "diamond":
      case "frame":
      case "line":
        setDraft({ type: tool, x1: world.x, y1: world.y, x2: world.x, y2: world.y });
        return;
      case "freehand":
        setDrawing([world.x, world.y]);
        return;
      case "connector": {
        const target = findObjectAt(world);
        if (!target) {
          store.setConnectorFrom(null);
          return;
        }
        if (!store.connectorFrom) store.setConnectorFrom(target.id);
        else if (store.connectorFrom !== target.id) {
          const a = ops.lookupBounds(store.connectorFrom);
          const b = ops.lookupBounds(target.id);
          if (a && b) {
            const sides = autoAnchors(a, b);
            const c = ops.add({ type: "connector", x: 0, y: 0, from: { objectId: store.connectorFrom, side: sides.from }, to: { objectId: target.id, side: sides.to }, zIndex: 5 });
            store.setSelected([c.id]);
          }
          store.setConnectorFrom(null);
          store.setTool("select");
        }
        return;
      }
    }
  };

  const findObjectAt = (p: { x: number; y: number }): CanvasObject | null => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const o = shapes[i]!;
      const b = objectBounds(o);
      if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return o;
    }
    return frames.find((f) => p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height) ?? null;
  };

  const onStagePointerMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    if (panning && panStart.current) {
      store.setViewport((v) => ({ ...v, x: panStart.current!.vx + (pos.x - panStart.current!.x), y: panStart.current!.vy + (pos.y - panStart.current!.y) }));
      return;
    }
    const world = screenToCanvas(pos, viewport);
    if (boxSel) setBoxSel({ ...boxSel, x2: world.x, y2: world.y });
    if (draft) setDraft({ ...draft, x2: world.x, y2: world.y });
    if (drawing) setDrawing([...drawing, world.x, world.y]);
    // throttled cursor awareness
    const now = Date.now();
    if (awareness && now - lastCursorSent.current > 40) {
      lastCursorSent.current = now;
      awareness.setLocalStateField("cursor", { x: Math.round(world.x), y: Math.round(world.y) });
    }
  };

  const onStagePointerUp = () => {
    if (panning) {
      setPanning(false);
      panStart.current = null;
    }
    if (boxSel) {
      const x = Math.min(boxSel.x1, boxSel.x2), y = Math.min(boxSel.y1, boxSel.y2), w = Math.abs(boxSel.x2 - boxSel.x1), h = Math.abs(boxSel.y2 - boxSel.y1);
      if (w > 4 && h > 4) {
        const hit = ops.objects.filter((o) => o.type !== "connector" && o.type !== "frame").filter((o) => { const b = objectBounds(o); return b.x >= x && b.y >= y && b.x + b.width <= x + w && b.y + b.height <= y + h; }).map((o) => o.id);
        store.setSelected(hit);
      }
      setBoxSel(null);
    }
    if (draft) {
      const x = Math.min(draft.x1, draft.x2), y = Math.min(draft.y1, draft.y2), w = Math.abs(draft.x2 - draft.x1), h = Math.abs(draft.y2 - draft.y1);
      if (draft.type === "line") {
        if (Math.hypot(w, h) > 4) {
          const o = ops.add({ type: "line", x: draft.x1, y: draft.y1, width: 0, height: 0, points: [0, 0, draft.x2 - draft.x1, draft.y2 - draft.y1], arrowEnd: false });
          store.setSelected([o.id]);
        }
      } else if (w > 6 && h > 6) createAt(draft.type, { x, y }, { x, y, width: snapIf(w), height: snapIf(h) });
      else createAt(draft.type, { x: draft.x1, y: draft.y1 });
      setDraft(null);
      store.setTool("select");
    }
    if (drawing) {
      if (drawing.length >= 4) {
        const xs = drawing.filter((_, i) => i % 2 === 0), ys = drawing.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        ops.add({ type: "freehand", x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, points: drawing.map((v, i) => (i % 2 === 0 ? v - minX : v - minY)), stroke: dark ? "#E8ECF5" : "#1F2430", strokeWidth: 3 });
      }
      setDrawing(null);
    }
  };

  // ---- Object interactions ------------------------------------------------------------
  const onObjectPointerDown = (e: KonvaEventObject<MouseEvent | TouchEvent>, obj: CanvasObject) => {
    if (tool === "hand" || store.spaceDown) return;
    if (tool === "connector") return;
    if (tool !== "select") return;
    e.cancelBubble = true;
    const mouse = e.evt as MouseEvent;
    if (mouse.shiftKey) store.toggleSelected(obj.id);
    else if (!selectedIds.includes(obj.id)) {
      // Selecting a grouped object selects the group
      const ids = obj.groupId ? ops.objects.filter((o) => o.groupId === obj.groupId).map((o) => o.id) : [obj.id];
      store.setSelected(ids);
    }
    if (editingId && editingId !== obj.id) store.setEditing(null);
  };
  const onDragStart = (_e: KonvaEventObject<DragEvent>, obj: CanvasObject) => {
    setDragging(true);
    const ids = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
    const all = new Set(ids);
    for (const id of ids) if (ops.byId.get(id)?.type === "frame") ops.childrenOf(id).forEach((c) => all.add(c.id));
    dragOrigin.current = new Map([...all].map((id) => [id, { x: ops.byId.get(id)!.x, y: ops.byId.get(id)!.y }]));
    dragOrigin.current.set("__lead", { x: obj.x, y: obj.y });
  };
  const lastDragSync = useRef(0);
  const applyDrag = (e: KonvaEventObject<DragEvent>, obj: CanvasObject, final: boolean) => {
    const lead = dragOrigin.current.get("__lead");
    if (!lead) return;
    const node = e.target;
    const dx = node.x() - lead.x;
    const dy = node.y() - lead.y;
    const patches: Array<{ id: string; patch: Partial<CanvasObjectInput> }> = [];
    for (const [id, o] of dragOrigin.current) {
      if (id === "__lead") continue;
      const nx = o.x + dx, ny = o.y + dy;
      patches.push({ id, patch: { x: final ? snapIf(nx) : nx, y: final ? snapIf(ny) : ny } });
    }
    if (final) {
      // Re-parent into a frame if dropped inside one
      const b = objectBounds({ ...obj, x: snapIf(obj.x + dx), y: snapIf(obj.y + dy) });
      if (obj.type !== "frame") {
        const parent = frames.find((f) => f.id !== obj.id && b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height);
        for (const p of patches) if (ops.byId.get(p.id)?.type !== "frame" && dragOrigin.current.size <= 2) p.patch.parentId = parent?.id ?? null;
      }
      node.position({ x: snapIf(obj.x + dx), y: snapIf(obj.y + dy) });
    }
    ops.updateMany(patches);
  };
  const onDragMove = (e: KonvaEventObject<DragEvent>, obj: CanvasObject) => {
    const now = Date.now();
    if (now - lastDragSync.current < 50) return;
    lastDragSync.current = now;
    applyDrag(e, obj, false);
  };
  const onDragEnd = (e: KonvaEventObject<DragEvent>, obj: CanvasObject) => {
    applyDrag(e, obj, true);
    dragOrigin.current.clear();
    setDragging(false);
  };
  const onTransformEnd = (e: KonvaEventObject<Event>, obj: CanvasObject) => {
    const node = e.target as Konva.Group;
    const sx = node.scaleX(), sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const patch: Partial<CanvasObjectInput> = { x: Math.round(node.x()), y: Math.round(node.y()), rotation: Math.round(node.rotation()) };
    if (obj.type === "freehand" || obj.type === "line") {
      patch.points = obj.points.map((v, i) => Math.round(v * (i % 2 === 0 ? sx : sy)));
      patch.width = Math.round(obj.width * sx);
      patch.height = Math.round(obj.height * sy);
    } else {
      patch.width = Math.max(10, Math.round(obj.width * sx));
      patch.height = Math.max(10, Math.round(obj.height * sy));
      if (obj.type === "text") patch.fontSize = Math.max(8, Math.round(obj.fontSize * sy));
    }
    ops.update(obj.id, patch);
    if (obj.type === "frame") {
      // keep children inside: children don't scale, frame just grows
    }
  };
  const onDblClick = (obj: CanvasObject) => {
    if (obj.type === "embed" && obj.url) return window.open(obj.url, "_blank", "noopener,noreferrer");
    if (obj.type === "task" && obj.taskId && workspaceSlug) return router.push(`/app/${workspaceSlug}/tasks?task=${obj.taskId}`);
    if (obj.type === "document" && obj.documentId && workspaceSlug) return router.push(`/app/${workspaceSlug}/docs/${obj.documentId}`);
    if (obj.type === "image" && obj.src) return window.open(obj.src, "_blank", "noopener,noreferrer");
    if (obj.type === "file" && obj.fileId) return window.open(`/api/v1/files/${obj.fileId}/download?download=1`, "_blank", "noopener,noreferrer");
    if (obj.type === "comment" && obj.threadId) {
      store.setRightPanel("comments");
      store.setActiveThreadId(obj.threadId);
      return;
    }
    if (readOnly || obj.locked) return;
    if (["sticky", "text", "rect", "ellipse", "diamond", "node", "frame", "connector"].includes(obj.type)) {
      store.setSelected([obj.id]);
      store.setEditing(obj.id);
    }
  };
  const onContext = (e: KonvaEventObject<PointerEvent>, obj: CanvasObject) => {
    e.evt.preventDefault();
    if (!selectedIds.includes(obj.id)) store.setSelected([obj.id]);
    setCtxTarget(obj);
  };

  // ---- Comments pins ------------------------------------------------------------------
  const createCommentPin = async (world: { x: number; y: number }) => {
    if (!canComment) return;
    const body = window.prompt("Add a comment");
    if (!body?.trim()) return store.setTool("select");
    try {
      const res = await post<{ threadId: string }>("/comments", { resourceType: "CANVAS", resourceId: canvasId, body: body.trim(), anchor: { kind: "canvas-position", x: Math.round(world.x), y: Math.round(world.y) } });
      ops.add({ type: "comment", x: world.x - 14, y: world.y - 14, width: 28, height: 28, threadId: res.threadId, zIndex: 1000 });
      void qc.invalidateQueries({ queryKey: ["comments", "CANVAS", canvasId] });
      store.setRightPanel("comments");
      store.setActiveThreadId(res.threadId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
    store.setTool("select");
  };
  const commentOnObject = async (obj: CanvasObject) => {
    const body = window.prompt(`Comment on this ${typeLabel(obj.type).toLowerCase()}`);
    if (!body?.trim()) return;
    try {
      const res = await post<{ threadId: string }>("/comments", { resourceType: "CANVAS", resourceId: canvasId, body: body.trim(), anchor: { kind: "canvas-object", objectId: obj.id } });
      void qc.invalidateQueries({ queryKey: ["comments", "CANVAS", canvasId] });
      store.setRightPanel("comments");
      store.setActiveThreadId(res.threadId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // ---- Uploads (drop / paste / tool) --------------------------------------------------
  const upload = useMutation({
    mutationFn: async ({ file, at }: { file: File; at: { x: number; y: number } }) => {
      if (!canvas.data) throw new Error("Canvas not loaded");
      const asset = await uploadFile(file, { workspaceId: canvas.data.workspaceId, projectId: canvas.data.projectId ?? undefined, resourceType: "CANVAS", resourceId: canvasId });
      const src = `${location.origin}/api/v1/files/${asset.id}/download`;
      if (asset.mimeType.startsWith("image/")) {
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 320, h: 240 });
          img.src = src;
        });
        const scale = Math.min(1, 480 / dims.w);
        createAt("image", at, { src, fileId: asset.id, fileName: asset.name, mimeType: asset.mimeType, width: Math.round(dims.w * scale), height: Math.round(dims.h * scale), alt: asset.name });
      } else createAt("file", at, { fileId: asset.id, fileName: asset.name, mimeType: asset.mimeType });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onFiles = (files: FileList | File[], at: { x: number; y: number }) => {
    if (readOnly) return;
    Array.from(files).forEach((file, i) => upload.mutate({ file, at: { x: at.x + i * 30, y: at.y + i * 30 } }));
  };

  // ---- Clipboard & shortcuts -------------------------------------------------------------
  const copySel = () => store.setClipboard(selected);
  useShortcut("mod+c", copySel, { enabled: !editingId });
  useShortcut("mod+x", () => { copySel(); ops.remove(selectedIds); }, { enabled: !editingId && !readOnly });
  useShortcut("mod+v", () => { const ids = ops.paste(store.clipboard, pointerSafe()); if (ids.length) store.setSelected(ids); }, { enabled: !editingId && !readOnly });
  useShortcut("mod+d", () => { const ids = ops.duplicate(selectedIds); if (ids.length) store.setSelected(ids); }, { enabled: !editingId && !readOnly });
  useShortcut("mod+a", () => store.setSelected(ops.objects.filter((o) => o.type !== "frame").map((o) => o.id)), { enabled: !editingId });
  useShortcut("delete", () => ops.remove(selectedIds), { enabled: !editingId && !readOnly && selectedIds.length > 0 });
  useShortcut("mod+z", () => ops.undo(), { enabled: !editingId && !readOnly });
  useShortcut(["mod+shift+z", "mod+y"], () => ops.redo(), { enabled: !editingId && !readOnly });
  useShortcut("mod+g", () => ops.group(selectedIds), { enabled: !editingId && !readOnly });
  useShortcut("mod+shift+g", () => ops.ungroup(selectedIds), { enabled: !editingId && !readOnly });
  useShortcut("mod+l", () => ops.setLocked(selectedIds, !selected.every((o) => o.locked)), { enabled: !editingId && !readOnly });
  useShortcut("]", () => ops.reorder(selectedIds, "forward"), { enabled: !editingId && !readOnly });
  useShortcut("[", () => ops.reorder(selectedIds, "backward"), { enabled: !editingId && !readOnly });
  useShortcut("shift+1", zoomToFit, { enabled: !editingId });
  useShortcut("shift+2", zoomToSelection, { enabled: !editingId });
  useShortcut("mod+0", () => store.setViewport((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, 1)), { enabled: !editingId });
  useShortcut(["=", "+"], () => zoomBy(1.2), { enabled: !editingId });
  useShortcut("-", () => zoomBy(1 / 1.2), { enabled: !editingId });
  useShortcut("escape", () => { if (presentationIndex !== null) store.setPresentationIndex(null); else if (editingId) store.setEditing(null); else { store.setSelected([]); store.setTool("select"); store.setConnectorFrom(null); } }, { enabled: true, allowInInputs: true });
  useShortcut("arrowright", () => presentationIndex !== null && gotoFrame(presentationIndex + 1), { enabled: presentationIndex !== null });
  useShortcut("arrowleft", () => presentationIndex !== null && gotoFrame(presentationIndex - 1), { enabled: presentationIndex !== null });
  const toolKeys: Array<[string, Tool]> = [["v", "select"], ["h", "hand"], ["n", "sticky"], ["t", "text"], ["r", "rect"], ["o", "ellipse"], ["d", "diamond"], ["l", "line"], ["a", "connector"], ["p", "freehand"], ["f", "frame"], ["c", "comment"], ["w", "node"], ["i", "image"], ["e", "embed"], ["k", "task"], ["g", "document"]];
  for (const [key, t] of toolKeys) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(key, () => !readOnly || t === "select" || t === "hand" ? store.setTool(t) : undefined, { enabled: !editingId });
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !editingId && !(e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable]")) { e.preventDefault(); store.setSpaceDown(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") store.setSpaceDown(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [editingId, store]);
  const pointerSafe = () => { const p = stageRef.current?.getPointerPosition(); return p ? screenToCanvas(p, viewport) : undefined; };

  // Paste images from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly || editingId) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); onFiles(files, pointerSafe() ?? screenToCanvas({ x: size.width / 2, y: size.height / 2 }, viewport)); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, editingId, viewport, size]);

  // ---- Presentation mode --------------------------------------------------------------
  const gotoFrame = (i: number) => {
    const sorted = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
    if (!sorted.length) return;
    const idx = Math.max(0, Math.min(sorted.length - 1, i));
    store.setPresentationIndex(idx);
    store.setViewport(fitBounds(objectBounds(sorted[idx]!), size, 60));
  };
  const exportFrame = (frame: CanvasObject) => {
    const layer = layerRef.current;
    if (!layer) return;
    const tl = canvasToScreen({ x: frame.x, y: frame.y - 32 }, viewport);
    const br = canvasToScreen({ x: frame.x + frame.width, y: frame.y + frame.height }, viewport);
    const url = layer.toDataURL({ x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y, pixelRatio: Math.max(1, 2 / viewport.scale) });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(frame.title || "section").replace(/[^a-z0-9]+/gi, "-")}.png`;
    a.click();
  };

  // ---- Text editing overlay -------------------------------------------------------------
  const editingObj = editingId ? ops.byId.get(editingId) : null;

  if (canvas.isError) return <div className="flex h-full items-center justify-center text-text-secondary">You don&apos;t have access to this canvas.</div>;
  if (!canvas.data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const gridSize = GRID * viewport.scale;
  const cursorClass = tool === "hand" || store.spaceDown || panning ? "cursor-grab active:cursor-grabbing" : tool === "select" ? "cursor-default" : "cursor-crosshair";

  return (
    <div className="flex h-full">
      <ContextMenu onOpenChange={(o) => !o && setCtxTarget(null)}>
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className={cn("canvas-stage relative flex-1 overflow-hidden", cursorClass)}
            style={{ background: "var(--canvas-bg)", backgroundImage: showGrid && gridSize > 6 ? `radial-gradient(var(--canvas-grid) ${Math.max(1, viewport.scale)}px, transparent ${Math.max(1, viewport.scale)}px)` : undefined, backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
            onDragOver={(e) => { if (!readOnly) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (readOnly) return; const rect = containerRef.current!.getBoundingClientRect(); onFiles(e.dataTransfer.files, screenToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport)); }}
          >
            <Stage
              ref={stageRef}
              width={size.width}
              height={size.height}
              x={viewport.x}
              y={viewport.y}
              scaleX={viewport.scale}
              scaleY={viewport.scale}
              onWheel={onWheel}
              onMouseDown={onStagePointerDown}
              onTouchStart={onStagePointerDown}
              onMouseMove={onStagePointerMove}
              onTouchMove={onStagePointerMove}
              onMouseUp={onStagePointerUp}
              onTouchEnd={onStagePointerUp}
              onMouseLeave={() => { onStagePointerUp(); awareness?.setLocalStateField("cursor", null); }}
              onContextMenu={(e) => e.evt.preventDefault()}
            >
              <Layer ref={layerRef}>
                {frames.map((f) => (
                  <CanvasObjectNode key={f.id} obj={f} selected={selectedIds.includes(f.id)} editing={editingId === f.id} readOnly={readOnly} draggable={tool === "select" && !store.spaceDown} dark={dark} resolved={resolved} shareToken={shareToken} onPointerDown={onObjectPointerDown} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDblClick={onDblClick} onTransformEnd={onTransformEnd} onContextMenu={onContext} onHover={store.setHovered} />
                ))}
                {connectors.map((c) => (
                  <ConnectorNode key={c.id} obj={c} lookup={ops.lookupBounds} selected={selectedIds.includes(c.id)} onPointerDown={onObjectPointerDown} onDblClick={onDblClick} onContextMenu={onContext} dark={dark} />
                ))}
                {shapes.map((o) => (
                  <CanvasObjectNode key={o.id} obj={o} selected={selectedIds.includes(o.id)} editing={editingId === o.id} readOnly={readOnly} draggable={tool === "select" && !store.spaceDown} dark={dark} resolved={resolved} shareToken={shareToken} onPointerDown={onObjectPointerDown} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDblClick={onDblClick} onTransformEnd={onTransformEnd} onContextMenu={onContext} onHover={store.setHovered} />
                ))}
                {/* Remote selections */}
                {others.map((o) => (o.selection ?? []).map((id) => { const b = ops.lookupBounds(id); return b ? <Rect key={`${o.clientId}-${id}`} x={b.x - 2} y={b.y - 2} width={b.width + 4} height={b.height + 4} stroke={o.user.color} strokeWidth={1.5 / viewport.scale} dash={[6 / viewport.scale, 4 / viewport.scale]} listening={false} /> : null; }))}
                {/* Connector source highlight */}
                {store.connectorFrom && ops.lookupBounds(store.connectorFrom) ? <Rect {...ops.lookupBounds(store.connectorFrom)!} stroke="#5B8CFF" strokeWidth={2 / viewport.scale} dash={[4, 4]} listening={false} /> : null}
                {boxSel ? <Rect x={Math.min(boxSel.x1, boxSel.x2)} y={Math.min(boxSel.y1, boxSel.y2)} width={Math.abs(boxSel.x2 - boxSel.x1)} height={Math.abs(boxSel.y2 - boxSel.y1)} fill="rgba(91,140,255,0.1)" stroke="#5B8CFF" strokeWidth={1 / viewport.scale} listening={false} /> : null}
                {draft && draft.type !== "line" ? <Rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.y1, draft.y2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.y2 - draft.y1)} stroke="#5B8CFF" dash={[6, 4]} strokeWidth={1.5 / viewport.scale} listening={false} /> : null}
                {draft && draft.type === "line" ? <Line points={[draft.x1, draft.y1, draft.x2, draft.y2]} stroke="#5B8CFF" strokeWidth={2 / viewport.scale} listening={false} /> : null}
                {drawing ? <Line points={drawing} stroke={dark ? "#E8ECF5" : "#1F2430"} strokeWidth={3} tension={0.4} lineCap="round" lineJoin="round" listening={false} /> : null}
                <Transformer ref={trRef} rotateEnabled keepRatio={false} borderStroke="#5B8CFF" anchorStroke="#5B8CFF" anchorFill="#fff" anchorSize={8} anchorCornerRadius={2} rotateAnchorOffset={24} ignoreStroke boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)} />
              </Layer>
            </Stage>

            {/* Remote cursors (HTML overlay) */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              {others.map((o) => {
                if (!o.cursor) return null;
                const p = canvasToScreen(o.cursor, viewport);
                if (p.x < -40 || p.y < -40 || p.x > size.width + 40 || p.y > size.height + 40) return null;
                return (
                  <div key={o.clientId} className="absolute transition-transform duration-75" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" style={{ color: o.user.color }}><path fill="currentColor" stroke="#fff" strokeWidth="1.5" d="M5 3l14 8-6.5 1.5L9 20z" /></svg>
                    <span className="ml-3 inline-block -translate-y-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" style={{ background: o.user.color }}>
                      {o.user.name}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Inline text editor */}
            {editingObj && !readOnly ? <TextEditOverlay obj={editingObj} viewport={viewport} onChange={(text) => ops.update(editingObj.id, editingObj.type === "frame" ? { title: text } : editingObj.type === "connector" ? { label: text } : { text })} onDone={() => store.setEditing(null)} lookupBounds={ops.lookupBounds} /> : null}

            {/* Floating UI */}
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
              <CanvasToolbar tool={tool} setTool={store.setTool} readOnly={readOnly} />
            </div>
            <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
              {store.showMinimap && size.width > 640 ? <Minimap objects={ops.objects} viewport={viewport} size={size} onNavigate={(c) => store.setViewport((v) => ({ ...v, x: size.width / 2 - c.x * v.scale, y: size.height / 2 - c.y * v.scale }))} /> : null}
              <CanvasZoomBar scale={viewport.scale} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={zoomToFit} onReset={() => store.setViewport((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, 1))} canUndo={ops.canUndo} canRedo={ops.canRedo} undo={ops.undo} redo={ops.redo} showGrid={showGrid} toggleGrid={store.toggleGrid} snap={snapToGrid} toggleSnap={store.toggleSnap} readOnly={readOnly} />
            </div>
            <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
              {store.connectorFrom ? <div className="pointer-events-auto rounded-lg border border-border px-3 py-1.5 text-xs shadow glass">Click a target object to connect · Esc to cancel</div> : null}
              {tool === "comment" ? <div className="pointer-events-auto rounded-lg border border-border px-3 py-1.5 text-xs shadow glass">Click anywhere to leave a comment pin</div> : null}
              {readOnly ? <div className="pointer-events-auto rounded-lg border border-border px-3 py-1.5 text-xs shadow glass">View-only — you can pan, zoom{canComment ? " and comment" : ""}</div> : null}
              {!collab.synced && collab.status === "connected" ? <div className="pointer-events-auto rounded-lg border border-border px-3 py-1.5 text-xs shadow glass">Syncing…</div> : null}
              {previewVersion ? <div className="pointer-events-auto rounded-lg border border-warning bg-warning-soft px-3 py-1.5 text-xs shadow">Previewing an older version — restore from the panel or exit preview.</div> : null}
            </div>
            {presentationIndex !== null ? (
              <div className="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border px-2 py-1.5 shadow-md glass">
                <Button size="icon-sm" variant="ghost" onClick={() => gotoFrame(presentationIndex - 1)} aria-label="Previous section"><ChevronLeft /></Button>
                <span className="text-xs font-medium">{frames.length ? `${presentationIndex + 1} / ${frames.length} · ${[...frames].sort((a, b) => a.y - b.y || a.x - b.x)[presentationIndex]?.title}` : "No sections"}</span>
                <Button size="icon-sm" variant="ghost" onClick={() => gotoFrame(presentationIndex + 1)} aria-label="Next section"><ChevronRight /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => store.setPresentationIndex(null)} aria-label="Exit presentation"><X /></Button>
              </div>
            ) : null}
            {selected.length > 0 && !rightPanel && !readOnly ? (
              <button className="pointer-events-auto absolute right-4 top-4 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium shadow glass" onClick={() => store.setRightPanel("properties")}>
                <SlidersHorizontal className="size-3.5" /> {selected.length === 1 ? typeLabel(selected[0]!.type) : `${selected.length} selected`}
              </button>
            ) : null}
            <input ref={fileInputRef} type="file" multiple accept={tool === "image" ? "image/*" : undefined} className="sr-only" onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files, pendingImageAt.current ?? screenToCanvas({ x: size.width / 2, y: size.height / 2 }, viewport)); e.target.value = ""; store.setTool("select"); }} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {ctxTarget ? (
            <>
              <ContextMenuLabel>{selected.length > 1 ? `${selected.length} objects` : typeLabel(ctxTarget.type)}</ContextMenuLabel>
              {!readOnly ? (
                <>
                  <ContextMenuItem onSelect={() => { copySel(); }} shortcut="⌘C">Copy</ContextMenuItem>
                  <ContextMenuItem onSelect={() => { const ids = ops.duplicate(selectedIds); store.setSelected(ids); }} shortcut="⌘D">Duplicate</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => ops.reorder(selectedIds, "front")}>Bring to front</ContextMenuItem>
                  <ContextMenuItem onSelect={() => ops.reorder(selectedIds, "forward")} shortcut="]">Bring forward</ContextMenuItem>
                  <ContextMenuItem onSelect={() => ops.reorder(selectedIds, "backward")} shortcut="[">Send backward</ContextMenuItem>
                  <ContextMenuItem onSelect={() => ops.reorder(selectedIds, "back")}>Send to back</ContextMenuItem>
                  <ContextMenuSeparator />
                  {selected.length > 1 ? <ContextMenuItem onSelect={() => ops.group(selectedIds)} shortcut="⌘G">Group</ContextMenuItem> : null}
                  {selected.some((o) => o.groupId) ? <ContextMenuItem onSelect={() => ops.ungroup(selectedIds)} shortcut="⌘⇧G">Ungroup</ContextMenuItem> : null}
                  {selected.length > 1 ? <ContextMenuItem onSelect={() => ops.arrange(selectedIds)}>Auto-arrange</ContextMenuItem> : null}
                  <ContextMenuItem onSelect={() => ops.setLocked(selectedIds, !ctxTarget.locked)} shortcut="⌘L">{ctxTarget.locked ? "Unlock" : "Lock"}</ContextMenuItem>
                  <ContextMenuSeparator />
                  {(ctxTarget.type === "sticky" || ctxTarget.type === "text" || ctxTarget.type === "node") && !ctxTarget.taskId ? <ContextMenuItem onSelect={() => setConvert(ctxTarget)}>Convert to task</ContextMenuItem> : null}
                  {ctxTarget.type === "frame" ? <ContextMenuItem onSelect={() => exportFrame(ctxTarget)}><Download /> Export section as PNG</ContextMenuItem> : null}
                  {ctxTarget.type === "frame" ? <ContextMenuItem onSelect={() => ops.update(ctxTarget.id, { collapsed: !ctxTarget.collapsed })}>{ctxTarget.collapsed ? "Expand" : "Collapse"} section</ContextMenuItem> : null}
                  {ctxTarget.type === "frame" ? <ContextMenuItem onSelect={() => { const kids = ops.childrenOf(ctxTarget.id); const b = unionBounds(kids.map((k) => objectBounds(k))); if (b) ops.update(ctxTarget.id, { x: b.x - 24, y: b.y - 24, width: b.width + 48, height: b.height + 48 }); }}>Fit section to content</ContextMenuItem> : null}
                </>
              ) : null}
              {canComment && ctxTarget.type !== "comment" ? <ContextMenuItem onSelect={() => void commentOnObject(ctxTarget)}>Comment</ContextMenuItem> : null}
              <ContextMenuItem onSelect={() => store.setRightPanel("properties")}>Properties</ContextMenuItem>
              {!readOnly ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem destructive onSelect={() => ops.remove(selectedIds)} shortcut="⌫">Delete</ContextMenuItem>
                </>
              ) : null}
            </>
          ) : (
            <>
              {!readOnly ? <ContextMenuItem onSelect={() => { const ids = ops.paste(store.clipboard, pointerSafe()); store.setSelected(ids); }} shortcut="⌘V" disabled={!store.clipboard.length}>Paste</ContextMenuItem> : null}
              <ContextMenuItem onSelect={() => store.setSelected(ops.objects.filter((o) => o.type !== "frame").map((o) => o.id))} shortcut="⌘A">Select all</ContextMenuItem>
              <ContextMenuItem onSelect={zoomToFit} shortcut="⇧1">Zoom to fit</ContextMenuItem>
              <ContextMenuItem onSelect={store.toggleGrid}>{showGrid ? "Hide" : "Show"} grid</ContextMenuItem>
              <ContextMenuItem onSelect={store.toggleMinimap}>{store.showMinimap ? "Hide" : "Show"} minimap</ContextMenuItem>
              {frames.length ? <ContextMenuItem onSelect={() => gotoFrame(0)}><Play /> Present sections</ContextMenuItem> : null}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Right panel */}
      {rightPanel ? (
        <aside className="w-80 shrink-0 border-l border-border bg-surface">
          {rightPanel === "properties" ? (
            selected.length ? (
              <PropertyPanel selected={selected} ops={ops} readOnly={readOnly} onClose={() => store.setRightPanel(null)} onConvertToTask={setConvert} onComment={(o) => void commentOnObject(o)} userId={user?.id ?? null} onOpenLink={onDblClick} />
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex h-12 items-center justify-between border-b border-border px-3"><h2 className="text-sm font-semibold">Properties</h2><Button variant="ghost" size="icon-xs" onClick={() => store.setRightPanel(null)} aria-label="Close"><X /></Button></div>
                <p className="p-4 text-sm text-text-secondary">Select an object to edit its properties.</p>
              </div>
            )
          ) : rightPanel === "comments" ? (
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center justify-between border-b border-border px-3"><h2 className="text-sm font-semibold">Comments</h2><Button variant="ghost" size="icon-xs" onClick={() => store.setRightPanel(null)} aria-label="Close"><X /></Button></div>
              <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
                <CommentThreads resourceType="CANVAS" resourceId={canvasId} canComment={canComment} highlightThreadId={store.activeThreadId} shareToken={shareToken} onCreateThread={canComment ? () => store.setTool("comment") : undefined} />
                {canComment ? <p className="mt-3 text-xs text-text-muted">Use the comment tool (C) to pin a comment anywhere, or right-click an object → Comment.</p> : null}
              </div>
            </div>
          ) : rightPanel === "sections" ? (
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center justify-between border-b border-border px-3"><h2 className="text-sm font-semibold">Sections</h2><Button variant="ghost" size="icon-xs" onClick={() => store.setRightPanel(null)} aria-label="Close"><X /></Button></div>
              <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {frames.length === 0 ? <p className="p-2 text-sm text-text-secondary">No sections yet. Use the Frame tool (F) to group content into named sections you can present and export.</p> : null}
                <ul className="space-y-1">
                  {[...frames].sort((a, b) => a.y - b.y || a.x - b.x).map((f, i) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <button className="min-w-0 flex-1 truncate text-left" onClick={() => { store.setSelected([f.id]); store.setViewport(fitBounds(objectBounds(f), size, 60)); }}>
                        <span className="mr-2 text-text-muted">{i + 1}.</span>{f.title || "Section"} <span className="text-xs text-text-muted">· {ops.childrenOf(f.id).length}</span>
                      </button>
                      <Button size="icon-xs" variant="ghost" aria-label="Export PNG" onClick={() => exportFrame(f)}><Download /></Button>
                    </li>
                  ))}
                </ul>
                {frames.length ? <Button className="mt-3 w-full" variant="subtle" size="sm" onClick={() => gotoFrame(0)}><Play /> Present</Button> : null}
              </div>
            </div>
          ) : (
            <VersionHistoryPanel type="canvas" id={canvasId} canEdit={!readOnly} onClose={() => { store.setRightPanel(null); setPreviewVersion(null); }} onPreview={setPreviewVersion} previewingId={previewVersion} />
          )}
        </aside>
      ) : null}

      {previewVersion ? <VersionPreviewOverlay canvasId={canvasId} versionId={previewVersion} onClose={() => setPreviewVersion(null)} /> : null}
      {picker?.kind === "task" ? <TaskPickerDialog onPick={(t) => { createAt("task", picker.at, { taskId: t.id, projectId: t.projectId }); setPicker(null); }} onClose={() => { setPicker(null); store.setTool("select"); }} /> : null}
      {picker?.kind === "document" ? <DocumentPickerDialog onPick={(d: DocumentDto) => { createAt("document", picker.at, { documentId: d.id }); setPicker(null); }} onClose={() => { setPicker(null); store.setTool("select"); }} /> : null}
      {picker?.kind === "embed" ? <EmbedDialog onSubmit={(url, title) => { createAt("embed", picker.at, { url, embedTitle: title || new URL(url).hostname }); setPicker(null); }} onClose={() => { setPicker(null); store.setTool("select"); }} /> : null}
      {convert ? <ConvertToTaskDialog canvasId={canvasId} object={convert} onClose={() => setConvert(null)} onConverted={(t) => ops.update(convert.id, { taskId: t.id, projectId: t.projectId })} /> : null}
    </div>
  );
}

function TextEditOverlay({ obj, viewport, onChange, onDone, lookupBounds }: { obj: CanvasObject; viewport: { x: number; y: number; scale: number }; onChange: (text: string) => void; onDone: () => void; lookupBounds: (id: string) => { x: number; y: number; width: number; height: number } | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const isFrame = obj.type === "frame";
  const isConnector = obj.type === "connector";
  const value = isFrame ? obj.title : isConnector ? obj.label : obj.text;
  let b = objectBounds(obj);
  if (isConnector) {
    const a = obj.from && "objectId" in obj.from ? lookupBounds(obj.from.objectId) : null;
    const c = obj.to && "objectId" in obj.to ? lookupBounds(obj.to.objectId) : null;
    const ax = a ? a.x + a.width / 2 : (obj.from as { x: number } | null)?.x ?? 0;
    const ay = a ? a.y + a.height / 2 : (obj.from as { y: number } | null)?.y ?? 0;
    const cx = c ? c.x + c.width / 2 : (obj.to as { x: number } | null)?.x ?? 0;
    const cy = c ? c.y + c.height / 2 : (obj.to as { y: number } | null)?.y ?? 0;
    b = { x: (ax + cx) / 2 - 80, y: (ay + cy) / 2 - 14, width: 160, height: 28 };
  }
  const p = canvasToScreen(isFrame ? { x: b.x, y: b.y - 30 } : b, viewport);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const style: React.CSSProperties = {
    position: "absolute",
    left: p.x + (isFrame || isConnector ? 0 : 10 * viewport.scale),
    top: p.y + (isFrame || isConnector ? 0 : 10 * viewport.scale),
    width: (isFrame ? Math.max(160, obj.title.length * 8 + 24) : isConnector ? 160 : Math.max(20, b.width - 20)) * viewport.scale,
    height: (isFrame ? 26 : isConnector ? 28 : Math.max(20, b.height - 20)) * viewport.scale,
    fontSize: (isFrame ? 13 : isConnector ? 11 : obj.fontSize) * viewport.scale,
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: isFrame || obj.fontWeight === "bold" ? 700 : 400,
    fontStyle: obj.fontStyle,
    textAlign: isFrame ? "left" : isConnector ? "center" : obj.textAlign,
    color: isFrame ? "#1F2430" : obj.textColor,
    lineHeight: 1.2,
    padding: isFrame ? `${6 * viewport.scale}px ${10 * viewport.scale}px` : 0,
    background: isFrame ? obj.stroke : isConnector ? "var(--surface)" : "transparent",
    border: isConnector ? "1px solid var(--primary)" : "none",
    borderRadius: 6,
    outline: "none",
    resize: "none",
    overflow: "hidden",
    transform: obj.rotation && !isConnector ? `rotate(${obj.rotation}deg)` : undefined,
    transformOrigin: "top left",
  };
  return (
    <textarea
      ref={ref}
      defaultValue={value}
      style={style}
      aria-label="Edit text"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter") || (isFrame && e.key === "Enter")) {
          e.preventDefault();
          onDone();
        }
        e.stopPropagation();
      }}
    />
  );
}

function VersionPreviewOverlay({ canvasId, versionId, onClose }: { canvasId: string; versionId: string; onClose: () => void }) {
  const q = useQuery<{ objects: CanvasObject[] }>({ queryKey: ["version", "canvas", canvasId, versionId], queryFn: () => import("@/lib/api").then((m) => m.get(`/canvases/${canvasId}/versions/${versionId}`)) });
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-8" onClick={onClose}>
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-xl border border-border bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Version preview</h3>
          <Button size="sm" variant="outline" onClick={onClose}>Exit preview</Button>
        </div>
        {q.data ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.objects.filter((o) => o.type !== "connector").map((o) => (
              <li key={o.id} className="rounded-md border border-border p-2 text-xs">
                <span className="font-medium">{typeLabel(o.type)}</span>
                {o.text || o.title ? <p className="mt-0.5 line-clamp-2 text-text-secondary">{o.text || o.title}</p> : null}
                <p className="text-[10px] text-text-muted">{Math.round(o.x)}, {Math.round(o.y)} · {Math.round(o.width)}×{Math.round(o.height)}</p>
              </li>
            ))}
            {q.data.objects.length === 0 ? <li className="text-sm text-text-secondary">This version is empty.</li> : null}
          </ul>
        ) : (
          <Spinner />
        )}
        <p className="mt-3 text-xs text-text-muted">{q.data?.objects.length ?? 0} objects in this version. Restoring replaces the live canvas and saves the current state as a recovery point.</p>
      </div>
    </div>
  );
}
