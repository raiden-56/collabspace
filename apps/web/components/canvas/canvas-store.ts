"use client";

import { create } from "zustand";
import type { CanvasObject } from "@collabspace/shared/canvas";

export type Tool = "select" | "hand" | "sticky" | "text" | "rect" | "ellipse" | "diamond" | "line" | "connector" | "freehand" | "image" | "file" | "comment" | "embed" | "task" | "document" | "frame" | "node";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface CanvasState {
  tool: Tool;
  selectedIds: string[];
  editingId: string | null;
  hoveredId: string | null;
  viewport: Viewport;
  showGrid: boolean;
  snapToGrid: boolean;
  showRulers: boolean;
  showMinimap: boolean;
  clipboard: CanvasObject[];
  connectorFrom: string | null;
  presentationIndex: number | null;
  rightPanel: "properties" | "comments" | "versions" | "sections" | null;
  activeThreadId: string | null;
  spaceDown: boolean;
  setTool: (t: Tool) => void;
  setSelected: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  setEditing: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setViewport: (v: Viewport | ((v: Viewport) => Viewport)) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleRulers: () => void;
  toggleMinimap: () => void;
  setClipboard: (objs: CanvasObject[]) => void;
  setConnectorFrom: (id: string | null) => void;
  setPresentationIndex: (i: number | null) => void;
  setRightPanel: (p: CanvasState["rightPanel"]) => void;
  setActiveThreadId: (id: string | null) => void;
  setSpaceDown: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  tool: "select" as Tool,
  selectedIds: [] as string[],
  editingId: null,
  hoveredId: null,
  viewport: { x: 0, y: 0, scale: 1 },
  showGrid: true,
  snapToGrid: false,
  showRulers: false,
  showMinimap: true,
  clipboard: [] as CanvasObject[],
  connectorFrom: null,
  presentationIndex: null,
  rightPanel: null,
  activeThreadId: null,
  spaceDown: false,
};

export const useCanvasStore = create<CanvasState>()((set) => ({
  ...initial,
  setTool: (tool) => set({ tool, connectorFrom: null, editingId: null }),
  setSelected: (selectedIds) => set({ selectedIds }),
  toggleSelected: (id) => set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id] })),
  setEditing: (editingId) => set({ editingId }),
  setHovered: (hoveredId) => set({ hoveredId }),
  setViewport: (v) => set((s) => ({ viewport: typeof v === "function" ? v(s.viewport) : v })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  setClipboard: (clipboard) => set({ clipboard }),
  setConnectorFrom: (connectorFrom) => set({ connectorFrom }),
  setPresentationIndex: (presentationIndex) => set({ presentationIndex }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setSpaceDown: (spaceDown) => set({ spaceDown }),
  reset: () => set({ ...initial }),
}));

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
export const GRID = 20;

export function screenToCanvas(p: { x: number; y: number }, v: Viewport) {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}
export function canvasToScreen(p: { x: number; y: number }, v: Viewport) {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

/** Zoom keeping the given screen point fixed. */
export function zoomAt(v: Viewport, screenPoint: { x: number; y: number }, nextScale: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  const world = screenToCanvas(screenPoint, v);
  return { scale, x: screenPoint.x - world.x * scale, y: screenPoint.y - world.y * scale };
}

export function fitBounds(bounds: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, padding = 80): Viewport {
  const w = Math.max(1, bounds.width);
  const h = Math.max(1, bounds.height);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((size.width - padding * 2) / w, (size.height - padding * 2) / h)));
  return { scale, x: size.width / 2 - (bounds.x + w / 2) * scale, y: size.height / 2 - (bounds.y + h / 2) * scale };
}
