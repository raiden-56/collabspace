"use client";

import { useMemo } from "react";
import { objectBounds, unionBounds, type CanvasObject } from "@collabspace/shared/canvas";
import type { Viewport } from "./canvas-store";

const W = 180;
const H = 120;

export function Minimap({ objects, viewport, size, onNavigate }: { objects: CanvasObject[]; viewport: Viewport; size: { width: number; height: number }; onNavigate: (center: { x: number; y: number }) => void }) {
  const world = useMemo(() => {
    const b = unionBounds(objects.filter((o) => o.type !== "connector").map((o) => objectBounds(o)));
    const vp = { x: -viewport.x / viewport.scale, y: -viewport.y / viewport.scale, width: size.width / viewport.scale, height: size.height / viewport.scale };
    const all = unionBounds([...(b ? [b] : []), vp])!;
    const pad = Math.max(all.width, all.height) * 0.08;
    return { x: all.x - pad, y: all.y - pad, width: all.width + pad * 2, height: all.height + pad * 2, vp };
  }, [objects, viewport, size]);
  const scale = Math.min(W / world.width, H / world.height);
  const ox = (W - world.width * scale) / 2;
  const oy = (H - world.height * scale) / 2;
  const tx = (x: number) => ox + (x - world.x) * scale;
  const ty = (y: number) => oy + (y - world.y) * scale;

  return (
    <svg
      width={W}
      height={H}
      className="pointer-events-auto cursor-crosshair rounded-lg border border-border shadow-md glass"
      role="img"
      aria-label="Minimap"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        onNavigate({ x: world.x + (px - ox) / scale, y: world.y + (py - oy) / scale });
      }}
    >
      {objects.map((o) => {
        if (o.type === "connector") return null;
        const b = objectBounds(o);
        return <rect key={o.id} x={tx(b.x)} y={ty(b.y)} width={Math.max(1.5, b.width * scale)} height={Math.max(1.5, b.height * scale)} rx={1} fill={o.type === "frame" ? "rgba(91,140,255,0.12)" : o.type === "sticky" ? o.color : "rgba(160,169,188,0.6)"} stroke={o.type === "frame" ? "rgba(91,140,255,0.5)" : "none"} strokeWidth={0.5} />;
      })}
      <rect x={tx(world.vp.x)} y={ty(world.vp.y)} width={world.vp.width * scale} height={world.vp.height * scale} fill="rgba(91,140,255,0.08)" stroke="#5B8CFF" strokeWidth={1.5} rx={2} />
    </svg>
  );
}
