"use client";

import { ArrowRight, Circle, Diamond, FileText, Frame, Grid3X3, Hand, Image as ImageIcon, Link2, Magnet, Maximize2, Minus, MousePointer2, Paperclip, Pencil, Plus, Redo2, Square, StickyNote, Type, Undo2, MessageSquare, CheckSquare, Workflow, ZoomIn, ZoomOut } from "lucide-react";
import type { Tool } from "./canvas-store";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const TOOLS: Array<{ tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string; key: string }> = [
  { tool: "select", icon: MousePointer2, label: "Select / move", key: "V" },
  { tool: "hand", icon: Hand, label: "Hand (pan)", key: "H" },
  { tool: "sticky", icon: StickyNote, label: "Sticky note", key: "N" },
  { tool: "text", icon: Type, label: "Text", key: "T" },
  { tool: "rect", icon: Square, label: "Rectangle", key: "R" },
  { tool: "ellipse", icon: Circle, label: "Circle", key: "O" },
  { tool: "diamond", icon: Diamond, label: "Diamond", key: "D" },
  { tool: "line", icon: Minus, label: "Line", key: "L" },
  { tool: "connector", icon: ArrowRight, label: "Arrow connector", key: "A" },
  { tool: "freehand", icon: Pencil, label: "Freehand pen", key: "P" },
  { tool: "image", icon: ImageIcon, label: "Image upload", key: "I" },
  { tool: "file", icon: Paperclip, label: "File attachment", key: "U" },
  { tool: "comment", icon: MessageSquare, label: "Comment pin", key: "C" },
  { tool: "embed", icon: Link2, label: "Embed / link", key: "E" },
  { tool: "task", icon: CheckSquare, label: "Task card", key: "K" },
  { tool: "document", icon: FileText, label: "Document card", key: "G" },
  { tool: "frame", icon: Frame, label: "Frame / section", key: "F" },
  { tool: "node", icon: Workflow, label: "Diagram node", key: "W" },
];

export function CanvasToolbar({ tool, setTool, readOnly }: { tool: Tool; setTool: (t: Tool) => void; readOnly: boolean }) {
  const visible = readOnly ? TOOLS.filter((t) => t.tool === "select" || t.tool === "hand") : TOOLS;
  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-0.5 overflow-x-auto rounded-xl border border-border p-1 shadow-md glass no-scrollbar" role="toolbar" aria-label="Canvas tools">
      {visible.map((t, i) => (
        <span key={t.tool} className="flex items-center">
          {(i === 2 || i === 10 || i === 16) && !readOnly ? <span className="mx-0.5 h-5 w-px bg-border" /> : null}
          <Tooltip content={t.label} shortcut={t.key} side="top">
            <button
              onClick={() => setTool(t.tool)}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              className={cn("flex size-9 items-center justify-center rounded-lg transition-colors", tool === t.tool ? "bg-primary text-white" : "text-text-secondary hover:bg-surface-2 hover:text-text")}
            >
              <t.icon className="size-4" />
            </button>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}

export function CanvasZoomBar({ scale, onZoomIn, onZoomOut, onFit, onReset, canUndo, canRedo, undo, redo, showGrid, toggleGrid, snap, toggleSnap, readOnly }: { scale: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; onReset: () => void; canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; showGrid: boolean; toggleGrid: () => void; snap: boolean; toggleSnap: () => void; readOnly: boolean }) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border p-1 shadow-md glass">
      {!readOnly ? (
        <>
          <Tooltip content="Undo" shortcut="⌘Z">
            <button onClick={undo} disabled={!canUndo} aria-label="Undo" className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-40">
              <Undo2 className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content="Redo" shortcut="⌘⇧Z">
            <button onClick={redo} disabled={!canRedo} aria-label="Redo" className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-40">
              <Redo2 className="size-4" />
            </button>
          </Tooltip>
          <span className="mx-0.5 h-5 w-px bg-border" />
        </>
      ) : null}
      <Tooltip content="Toggle grid">
        <button onClick={toggleGrid} aria-pressed={showGrid} aria-label="Toggle grid" className={cn("flex size-8 items-center justify-center rounded-lg hover:bg-surface-2", showGrid ? "text-primary" : "text-text-secondary")}>
          <Grid3X3 className="size-4" />
        </button>
      </Tooltip>
      {!readOnly ? (
        <Tooltip content="Snap to grid">
          <button onClick={toggleSnap} aria-pressed={snap} aria-label="Snap to grid" className={cn("flex size-8 items-center justify-center rounded-lg hover:bg-surface-2", snap ? "text-primary" : "text-text-secondary")}>
            <Magnet className="size-4" />
          </button>
        </Tooltip>
      ) : null}
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Tooltip content="Zoom out" shortcut="-">
        <button onClick={onZoomOut} aria-label="Zoom out" className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
          <ZoomOut className="size-4" />
        </button>
      </Tooltip>
      <Tooltip content="Reset zoom" shortcut="⌘0">
        <button onClick={onReset} className="min-w-[48px] rounded-lg px-1 text-xs font-medium tabular-nums text-text-secondary hover:bg-surface-2" aria-label="Reset zoom">
          {Math.round(scale * 100)}%
        </button>
      </Tooltip>
      <Tooltip content="Zoom in" shortcut="+">
        <button onClick={onZoomIn} aria-label="Zoom in" className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
          <ZoomIn className="size-4" />
        </button>
      </Tooltip>
      <Tooltip content="Zoom to fit" shortcut="⇧1">
        <button onClick={onFit} aria-label="Zoom to fit" className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
          <Maximize2 className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}

export { Plus as PlusIcon };
