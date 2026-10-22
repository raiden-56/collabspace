"use client";

import { motion, useReducedMotion } from "motion/react";
import { MousePointer2 } from "lucide-react";

/**
 * Animated product preview for the landing page. This is an illustrative mockup —
 * the authenticated app renders the real canvas, board and presence components.
 */
const cursors = [
  { name: "Maya", color: "#5B8CFF", path: [{ x: 120, y: 90 }, { x: 260, y: 140 }, { x: 410, y: 110 }, { x: 300, y: 220 }] },
  { name: "Theo", color: "#31B887", path: [{ x: 520, y: 240 }, { x: 440, y: 300 }, { x: 600, y: 180 }, { x: 560, y: 260 }] },
  { name: "Ana", color: "#F4B740", path: [{ x: 200, y: 300 }, { x: 150, y: 220 }, { x: 240, y: 160 }, { x: 180, y: 280 }] },
];

const notes = [
  { x: 80, y: 70, w: 150, h: 100, color: "#FFE66D", text: "Onboarding should feel like a tour, not a form" },
  { x: 250, y: 110, w: 150, h: 100, color: "#B5EAD7", text: "Convert sticky notes into tasks in one click" },
  { x: 120, y: 200, w: 150, h: 100, color: "#C7CEEA", text: "Live cursors show who is working where" },
];

const columns = [
  { title: "To do", items: ["Design empty states", "Write onboarding copy"] },
  { title: "In progress", items: ["Canvas → task conversion"] },
  { title: "Done", items: ["Presence avatars", "Share links"] },
];

export function HeroPreview() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto mt-14 w-full max-w-5xl" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-b from-primary/20 via-secondary/10 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
        <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2 px-4">
          <span className="size-3 rounded-full bg-error/70" />
          <span className="size-3 rounded-full bg-warning/70" />
          <span className="size-3 rounded-full bg-success/70" />
          <span className="ml-4 rounded-md bg-surface px-2 py-0.5 text-[11px] text-text-muted">Product kickoff · Brainstorm</span>
          <div className="ml-auto flex -space-x-2">
            {cursors.map((c) => (
              <span key={c.name} className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-surface-2" style={{ background: c.color }}>
                {c.name[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-[1.4fr_1fr]">
          <div
            className="relative h-[360px] overflow-hidden border-r border-border"
            style={{ backgroundColor: "var(--canvas-bg)", backgroundImage: "radial-gradient(var(--canvas-grid) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
          >
            <div className="absolute left-4 top-4 rounded-lg border border-border bg-surface/90 px-2 py-1 text-[11px] text-text-secondary shadow-sm">Ideas · 3 notes</div>
            {notes.map((n, i) => (
              <motion.div
                key={i}
                className="absolute rounded-md p-3 text-[12px] font-medium leading-snug text-[#1F2430] shadow-md"
                style={{ left: n.x, top: n.y, width: n.w, height: n.h, background: n.color }}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.15, duration: 0.5 }}
              >
                {n.text}
              </motion.div>
            ))}
            <motion.svg className="absolute inset-0 size-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
              <path d="M230 120 C 240 120, 240 160, 250 160" stroke="#5B8CFF" strokeWidth="2" fill="none" markerEnd="url(#arrow)" />
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="#5B8CFF" />
                </marker>
              </defs>
            </motion.svg>
            {cursors.map((c, i) => (
              <motion.div
                key={c.name}
                className="pointer-events-none absolute"
                initial={{ x: c.path[0]!.x, y: c.path[0]!.y }}
                animate={reduce ? {} : { x: c.path.map((p) => p.x), y: c.path.map((p) => p.y) }}
                transition={{ duration: 9 + i * 2, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
              >
                <MousePointer2 className="size-4 drop-shadow" style={{ color: c.color, fill: c.color }} />
                <span className="ml-3 -mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" style={{ background: c.color }}>
                  {c.name}
                </span>
              </motion.div>
            ))}
          </div>
          <div className="hidden h-[360px] flex-col gap-3 bg-surface p-4 md:flex">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-secondary">Sprint board</span>
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">live</span>
            </div>
            <div className="grid flex-1 grid-cols-3 gap-2">
              {columns.map((col, ci) => (
                <div key={col.title} className="flex flex-col gap-2 rounded-lg bg-surface-2 p-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{col.title}</span>
                  {col.items.map((item, ii) => (
                    <motion.div
                      key={item}
                      className="rounded-md border border-border bg-surface p-2 text-[11px] leading-snug shadow-sm"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.8 + ci * 0.2 + ii * 0.1 }}
                    >
                      {item}
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="rounded bg-primary-soft px-1 text-[9px] text-primary">PRJ-{ci * 3 + ii + 1}</span>
                        <span className="size-4 rounded-full" style={{ background: cursors[(ci + ii) % 3]!.color }} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
            <motion.div className="rounded-lg border border-border bg-surface-2 p-3 text-[11px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-text-secondary">
                <span className="size-1.5 rounded-full bg-secondary" /> AI meeting recap
              </div>
              <p className="text-text-secondary">3 decisions · 4 action items drafted for review · 1 open question</p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
