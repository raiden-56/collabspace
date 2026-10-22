"use client";

import { memo, useEffect, useState } from "react";
import { Group, Rect, Ellipse, Line, Arrow, Text, Image as KImage, RegularPolygon, Circle } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { resolveConnectorEnd, type CanvasObject, type Bounds } from "@collabspace/shared/canvas";

export interface ResolvedLink {
  tasks: Map<string, { key: string; title: string; status: string; priority: string; assignee: { name: string; color: string } | null; completedAt: string | null }>;
  documents: Map<string, { title: string; icon: string | null }>;
}

export interface ObjectNodeProps {
  obj: CanvasObject;
  selected: boolean;
  editing: boolean;
  readOnly: boolean;
  draggable: boolean;
  dark: boolean;
  resolved: ResolvedLink;
  shareToken?: string | null;
  onPointerDown: (e: KonvaEventObject<MouseEvent | TouchEvent>, obj: CanvasObject) => void;
  onDragStart: (e: KonvaEventObject<DragEvent>, obj: CanvasObject) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>, obj: CanvasObject) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>, obj: CanvasObject) => void;
  onDblClick: (obj: CanvasObject) => void;
  onTransformEnd: (e: KonvaEventObject<Event>, obj: CanvasObject) => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>, obj: CanvasObject) => void;
  onHover: (id: string | null) => void;
}

function useKonvaImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImg(null);
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = src;
    return () => {
      el.onload = null;
    };
  }, [src]);
  return img;
}

const SHADOW = { shadowColor: "rgba(16,24,40,0.25)", shadowBlur: 10, shadowOffset: { x: 0, y: 3 }, shadowOpacity: 0.6 };

export const CanvasObjectNode = memo(function CanvasObjectNode(p: ObjectNodeProps) {
  const { obj } = p;
  const common = {
    id: obj.id,
    name: "object",
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    opacity: obj.opacity,
    draggable: p.draggable && !obj.locked && !p.readOnly,
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => p.onPointerDown(e, obj),
    onTouchStart: (e: KonvaEventObject<TouchEvent>) => p.onPointerDown(e, obj),
    onDragStart: (e: KonvaEventObject<DragEvent>) => p.onDragStart(e, obj),
    onDragMove: (e: KonvaEventObject<DragEvent>) => p.onDragMove(e, obj),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => p.onDragEnd(e, obj),
    onDblClick: () => p.onDblClick(obj),
    onDblTap: () => p.onDblClick(obj),
    onTransformEnd: (e: KonvaEventObject<Event>) => p.onTransformEnd(e, obj),
    onContextMenu: (e: KonvaEventObject<PointerEvent>) => p.onContextMenu(e, obj),
    onMouseEnter: () => p.onHover(obj.id),
    onMouseLeave: () => p.onHover(null),
  };
  const textVisible = !p.editing;

  switch (obj.type) {
    case "sticky":
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={obj.color} cornerRadius={6} {...SHADOW} perfectDrawEnabled={false} />
          {textVisible ? <Text text={obj.text} width={obj.width - 20} height={obj.height - 20} x={10} y={10} fontSize={obj.fontSize} fontStyle={`${obj.fontWeight === "bold" ? "bold" : ""} ${obj.fontStyle === "italic" ? "italic" : ""}`.trim() || "normal"} fontFamily="Inter, system-ui, sans-serif" fill={obj.textColor} align={obj.textAlign} verticalAlign="middle" wrap="word" ellipsis listening={false} /> : null}
          {obj.tags.length ? <Text text={obj.tags.map((t) => `#${t}`).join(" ")} x={8} y={obj.height - 16} fontSize={9} fill="rgba(31,36,48,0.6)" listening={false} /> : null}
          {Object.keys(obj.reactions).length ? <Text text={Object.entries(obj.reactions).map(([e, u]) => `${e}${u.length > 1 ? u.length : ""}`).join(" ")} x={obj.width - 8} y={obj.height - 18} fontSize={11} align="right" width={obj.width - 16} listening={false} /> : null}
          {obj.taskId ? <Circle x={obj.width - 10} y={10} radius={5} fill="#5B8CFF" listening={false} /> : null}
          {obj.locked ? <Text text="🔒" x={4} y={2} fontSize={10} listening={false} /> : null}
        </Group>
      );
    case "text":
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill="transparent" />
          {textVisible ? <Text text={obj.text || (p.readOnly ? "" : "Type…")} width={obj.width} fontSize={obj.fontSize} fontStyle={`${obj.fontWeight === "bold" ? "bold" : ""} ${obj.fontStyle === "italic" ? "italic" : ""}`.trim() || "normal"} fontFamily="Inter, system-ui, sans-serif" fill={obj.text ? (p.dark && obj.textColor === "#1F2430" ? "#E8ECF5" : obj.textColor) : "#A0A9BC"} align={obj.textAlign} wrap="word" listening={false} /> : null}
        </Group>
      );
    case "rect":
    case "node":
      return (
        <Group {...common}>
          {obj.type === "node" && obj.nodeShape === "ellipse" ? (
            <Ellipse x={obj.width / 2} y={obj.height / 2} radiusX={obj.width / 2} radiusY={obj.height / 2} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
          ) : obj.type === "node" && obj.nodeShape === "diamond" ? (
            <Line points={[obj.width / 2, 0, obj.width, obj.height / 2, obj.width / 2, obj.height, 0, obj.height / 2]} closed fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
          ) : obj.type === "node" && obj.nodeShape === "parallelogram" ? (
            <Line points={[obj.width * 0.2, 0, obj.width, 0, obj.width * 0.8, obj.height, 0, obj.height]} closed fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
          ) : obj.type === "node" && obj.nodeShape === "cylinder" ? (
            <>
              <Rect y={obj.height * 0.12} width={obj.width} height={obj.height * 0.76} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
              <Ellipse x={obj.width / 2} y={obj.height * 0.12} radiusX={obj.width / 2} radiusY={obj.height * 0.12} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
              <Ellipse x={obj.width / 2} y={obj.height * 0.88} radiusX={obj.width / 2} radiusY={obj.height * 0.12} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
            </>
          ) : (
            <Rect width={obj.width} height={obj.height} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} cornerRadius={obj.type === "node" && obj.nodeShape === "rect" ? 0 : obj.cornerRadius} perfectDrawEnabled={false} />
          )}
          {textVisible && obj.text ? <Text text={obj.text} width={obj.width - 16} height={obj.height} x={8} fontSize={obj.fontSize} fontFamily="Inter, system-ui, sans-serif" fill={obj.textColor} align={obj.textAlign} verticalAlign="middle" wrap="word" ellipsis listening={false} /> : null}
        </Group>
      );
    case "ellipse":
      return (
        <Group {...common}>
          <Ellipse x={obj.width / 2} y={obj.height / 2} radiusX={obj.width / 2} radiusY={obj.height / 2} fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
          {textVisible && obj.text ? <Text text={obj.text} width={obj.width - 24} height={obj.height} x={12} fontSize={obj.fontSize} fontFamily="Inter, system-ui, sans-serif" fill={obj.textColor} align={obj.textAlign} verticalAlign="middle" wrap="word" ellipsis listening={false} /> : null}
        </Group>
      );
    case "diamond":
      return (
        <Group {...common}>
          <Line points={[obj.width / 2, 0, obj.width, obj.height / 2, obj.width / 2, obj.height, 0, obj.height / 2]} closed fill={obj.fill} stroke={obj.stroke} strokeWidth={obj.strokeWidth} perfectDrawEnabled={false} />
          {textVisible && obj.text ? <Text text={obj.text} width={obj.width * 0.6} height={obj.height} x={obj.width * 0.2} fontSize={obj.fontSize} fontFamily="Inter, system-ui, sans-serif" fill={obj.textColor} align="center" verticalAlign="middle" wrap="word" ellipsis listening={false} /> : null}
        </Group>
      );
    case "line":
    case "freehand":
      return (
        <Group {...common}>
          <Line points={obj.points} stroke={obj.stroke} strokeWidth={obj.strokeWidth} lineCap="round" lineJoin="round" tension={obj.type === "freehand" ? 0.4 : 0} dash={obj.lineStyle === "dashed" ? [10, 6] : obj.lineStyle === "dotted" ? [2, 6] : undefined} hitStrokeWidth={Math.max(12, obj.strokeWidth)} perfectDrawEnabled={false} />
        </Group>
      );
    case "frame":
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={obj.fill} stroke={obj.stroke} strokeWidth={1} cornerRadius={10} perfectDrawEnabled={false} />
          <Rect width={Math.min(obj.width, Math.max(80, obj.title.length * 8 + 24))} height={26} y={-30} fill={obj.stroke} cornerRadius={6} perfectDrawEnabled={false} />
          <Text text={obj.title || "Section"} x={10} y={-24} fontSize={13} fontStyle="bold" fontFamily="Inter, system-ui, sans-serif" fill="#1F2430" listening={false} />
          {obj.collapsed ? <Text text="Collapsed section" x={obj.width / 2 - 50} y={obj.height / 2 - 8} fontSize={13} fill="#8A93A8" listening={false} /> : null}
        </Group>
      );
    case "image":
      return <ImageNode {...p} common={common} />;
    case "file":
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={p.dark ? "#1B2238" : "#FFFFFF"} stroke={obj.stroke} strokeWidth={1} cornerRadius={8} {...SHADOW} perfectDrawEnabled={false} />
          <Text text="📎" x={12} y={14} fontSize={22} listening={false} />
          <Text text={obj.fileName ?? "File"} x={46} y={14} width={obj.width - 58} fontSize={13} fontStyle="bold" fill={p.dark ? "#E8ECF5" : "#1F2430"} ellipsis wrap="none" listening={false} />
          <Text text={obj.mimeType ?? ""} x={46} y={34} width={obj.width - 58} fontSize={11} fill="#8A93A8" ellipsis wrap="none" listening={false} />
        </Group>
      );
    case "embed":
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={p.dark ? "#1B2238" : "#FFFFFF"} stroke={obj.stroke} strokeWidth={1} cornerRadius={8} {...SHADOW} perfectDrawEnabled={false} />
          <Rect width={obj.width} height={6} fill={obj.stroke} cornerRadius={[8, 8, 0, 0]} perfectDrawEnabled={false} />
          <Text text="🔗" x={12} y={16} fontSize={18} listening={false} />
          <Text text={obj.embedTitle || obj.url || "Link"} x={40} y={16} width={obj.width - 52} fontSize={13} fontStyle="bold" fill={p.dark ? "#E8ECF5" : "#1F2430"} ellipsis wrap="none" listening={false} />
          <Text text={obj.url ?? ""} x={40} y={36} width={obj.width - 52} fontSize={11} fill="#5B8CFF" ellipsis wrap="none" listening={false} />
          <Text text="Double-click to open" x={12} y={obj.height - 20} fontSize={10} fill="#8A93A8" listening={false} />
        </Group>
      );
    case "task": {
      const t = obj.taskId ? p.resolved.tasks.get(obj.taskId) : undefined;
      const done = Boolean(t?.completedAt);
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={p.dark ? "#1B2238" : "#FFFFFF"} stroke={done ? "#31B887" : obj.stroke} strokeWidth={1.5} cornerRadius={8} {...SHADOW} perfectDrawEnabled={false} />
          <Rect x={10} y={12} width={16} height={16} cornerRadius={4} stroke={done ? "#31B887" : "#A0A9BC"} fill={done ? "#31B887" : "transparent"} strokeWidth={1.5} perfectDrawEnabled={false} />
          {done ? <Text text="✓" x={12} y={11} fontSize={13} fill="#fff" listening={false} /> : null}
          <Text text={t?.key ?? "TASK"} x={34} y={10} fontSize={10} fill="#5B8CFF" fontStyle="bold" listening={false} />
          <Text text={t ? t.title : obj.taskId ? "Task not accessible" : "No task linked"} x={10} y={32} width={obj.width - 20} height={obj.height - 56} fontSize={13} fontFamily="Inter, system-ui, sans-serif" fill={p.dark ? "#E8ECF5" : "#1F2430"} wrap="word" ellipsis listening={false} textDecoration={done ? "line-through" : undefined} />
          {t ? <Text text={`${t.status.replace("_", " ")}${t.assignee ? ` · ${t.assignee.name}` : ""}`} x={10} y={obj.height - 18} width={obj.width - 20} fontSize={10} fill="#8A93A8" ellipsis wrap="none" listening={false} /> : null}
        </Group>
      );
    }
    case "document": {
      const d = obj.documentId ? p.resolved.documents.get(obj.documentId) : undefined;
      return (
        <Group {...common}>
          <Rect width={obj.width} height={obj.height} fill={p.dark ? "#1B2238" : "#FFFFFF"} stroke={obj.stroke} strokeWidth={1} cornerRadius={8} {...SHADOW} perfectDrawEnabled={false} />
          <Text text={d?.icon ?? "📄"} x={12} y={14} fontSize={22} listening={false} />
          <Text text={d ? d.title : obj.documentId ? "Document not accessible" : "No document linked"} x={46} y={16} width={obj.width - 58} height={obj.height - 32} fontSize={13} fontStyle="bold" fontFamily="Inter, system-ui, sans-serif" fill={p.dark ? "#E8ECF5" : "#1F2430"} wrap="word" ellipsis listening={false} />
          <Text text="Document · double-click to open" x={12} y={obj.height - 18} fontSize={10} fill="#8A93A8" listening={false} />
        </Group>
      );
    }
    case "comment":
      return (
        <Group {...common}>
          <RegularPolygon sides={6} radius={14} x={14} y={14} fill="#F4B740" stroke="#fff" strokeWidth={2} {...SHADOW} perfectDrawEnabled={false} />
          <Text text="💬" x={5} y={6} fontSize={14} listening={false} />
        </Group>
      );
    default:
      return null;
  }
});

function ImageNode(p: ObjectNodeProps & { common: Record<string, unknown> }) {
  const { obj } = p;
  const src = obj.src ? (p.shareToken && obj.src.includes("/api/v1/files/") ? `${obj.src}${obj.src.includes("?") ? "&" : "?"}share=${p.shareToken}` : obj.src) : null;
  const img = useKonvaImage(src);
  return (
    <Group {...(p.common as object)}>
      {img ? <KImage image={img} width={obj.width} height={obj.height} cornerRadius={obj.cornerRadius} {...SHADOW} perfectDrawEnabled={false} /> : <Rect width={obj.width} height={obj.height} fill={p.dark ? "#232C46" : "#E6E9F2"} cornerRadius={obj.cornerRadius} perfectDrawEnabled={false} />}
      {!img ? <Text text={obj.alt || "Loading image…"} x={0} y={obj.height / 2 - 7} width={obj.width} align="center" fontSize={12} fill="#8A93A8" listening={false} /> : null}
    </Group>
  );
}

export const ConnectorNode = memo(function ConnectorNode({ obj, lookup, selected, onPointerDown, onDblClick, onContextMenu, dark }: { obj: CanvasObject; lookup: (id: string) => Bounds | null; selected: boolean; onPointerDown: (e: KonvaEventObject<MouseEvent | TouchEvent>, obj: CanvasObject) => void; onDblClick: (obj: CanvasObject) => void; onContextMenu: (e: KonvaEventObject<PointerEvent>, obj: CanvasObject) => void; dark: boolean }) {
  const a = resolveConnectorEnd(obj.from, lookup);
  const b = resolveConnectorEnd(obj.to, lookup);
  if (!a || !b) return null;
  // Smooth curve via a midpoint control: horizontal-ish or vertical-ish bend.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const c1 = horizontal ? { x: a.x + dx / 2, y: a.y } : { x: a.x, y: a.y + dy / 2 };
  const c2 = horizontal ? { x: a.x + dx / 2, y: b.y } : { x: b.x, y: a.y + dy / 2 };
  const points = [a.x, a.y, c1.x, c1.y, c2.x, c2.y, b.x, b.y];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <Group id={obj.id} name="object connector" onMouseDown={(e) => onPointerDown(e, obj)} onTouchStart={(e) => onPointerDown(e, obj)} onDblClick={() => onDblClick(obj)} onDblTap={() => onDblClick(obj)} onContextMenu={(e) => onContextMenu(e, obj)} opacity={obj.opacity}>
      <Arrow points={points} bezier stroke={selected ? "#5B8CFF" : obj.stroke} strokeWidth={selected ? obj.strokeWidth + 1 : obj.strokeWidth} fill={selected ? "#5B8CFF" : obj.stroke} pointerAtBeginning={obj.arrowStart} pointerAtEnding={obj.arrowEnd} pointerLength={10} pointerWidth={9} dash={obj.lineStyle === "dashed" ? [10, 6] : obj.lineStyle === "dotted" ? [2, 6] : undefined} hitStrokeWidth={16} lineCap="round" perfectDrawEnabled={false} />
      {obj.label ? (
        <Group x={mid.x} y={mid.y}>
          <Rect x={-(obj.label.length * 3.6 + 10)} y={-10} width={obj.label.length * 7.2 + 20} height={20} fill={dark ? "#151B2E" : "#FFFFFF"} stroke={obj.stroke} strokeWidth={1} cornerRadius={10} perfectDrawEnabled={false} />
          <Text text={obj.label} x={-(obj.label.length * 3.6 + 10)} y={-6} width={obj.label.length * 7.2 + 20} align="center" fontSize={11} fontFamily="Inter, system-ui, sans-serif" fill={dark ? "#E8ECF5" : "#1F2430"} listening={false} />
        </Group>
      ) : null}
    </Group>
  );
});

export type KonvaNode = Konva.Node;
