"use client";

import { useMemo } from "react";
import { addDays, differenceInCalendarDays, format, startOfDay, isToday } from "date-fns";
import { AlertTriangle, Flag } from "lucide-react";
import type { MilestoneDto, TaskDto } from "@/lib/api";
import { UserAvatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const DAY_PX = 28;

/**
 * Gantt-style timeline: tasks as bars (start → due, or a single day on the due date),
 * dependency links drawn between bars, milestones as markers.
 */
export function TimelineView({ tasks, milestones, onOpen }: { tasks: TaskDto[]; milestones: MilestoneDto[]; onOpen: (id: string) => void }) {
  const dated = tasks.filter((t) => t.dueDate || t.startDate);
  const { start, days } = useMemo(() => {
    const dates = [...dated.flatMap((t) => [t.startDate, t.dueDate].filter(Boolean).map((d) => new Date(d!))), ...milestones.map((m) => new Date(m.dueDate)), new Date()];
    const min = startOfDay(new Date(Math.min(...dates.map((d) => d.getTime()))));
    const max = startOfDay(new Date(Math.max(...dates.map((d) => d.getTime()))));
    const s = addDays(min, -3);
    return { start: s, days: Math.max(21, differenceInCalendarDays(max, s) + 8) };
  }, [dated, milestones]);
  const x = (d: Date | string) => differenceInCalendarDays(startOfDay(new Date(d)), start) * DAY_PX;
  const rows = useMemo(() => [...dated].sort((a, b) => new Date(a.startDate ?? a.dueDate!).getTime() - new Date(b.startDate ?? b.dueDate!).getTime()), [dated]);
  const rowIndex = new Map(rows.map((t, i) => [t.id, i]));
  const ROW = 36;
  const HEADER = 44;
  const width = days * DAY_PX;
  const height = HEADER + rows.length * ROW + 20;

  if (!dated.length) return <div className="rounded-xl border border-dashed border-border-strong p-10 text-center text-sm text-text-secondary">Add start or due dates to tasks to see them on the timeline.</div>;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-surface">
      <div className="w-64 shrink-0 border-r border-border">
        <div className="flex h-11 items-center border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Task</div>
        {rows.map((t) => (
          <button key={t.id} onClick={() => onOpen(t.id)} className="flex h-9 w-full items-center gap-2 border-b border-border/60 px-3 text-left text-sm hover:bg-surface-2">
            <span className="font-mono text-[10px] text-text-muted">{t.key}</span>
            <span className={cn("min-w-0 flex-1 truncate", t.completedAt && "text-text-muted line-through")}>{t.title}</span>
            {t.blocked ? <AlertTriangle className="size-3.5 text-error" /> : null}
            {t.assignee ? <UserAvatar user={t.assignee} size="xs" /> : null}
          </button>
        ))}
      </div>
      <div className="relative flex-1 overflow-x-auto scrollbar-thin">
        <svg width={width} height={height} className="block" role="img" aria-label="Project timeline">
          {Array.from({ length: days }).map((_, i) => {
            const d = addDays(start, i);
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <g key={i}>
                <rect x={i * DAY_PX} y={0} width={DAY_PX} height={height} fill={isToday(d) ? "var(--primary-soft)" : weekend ? "var(--surface-2)" : "transparent"} opacity={isToday(d) ? 0.6 : 0.5} />
                <line x1={i * DAY_PX} y1={0} x2={i * DAY_PX} y2={height} stroke="var(--border)" strokeWidth={0.5} />
                {d.getDate() === 1 || i === 0 ? <text x={i * DAY_PX + 4} y={14} fontSize={10} fontWeight={600} fill="var(--text-secondary)">{format(d, "MMM yyyy")}</text> : null}
                <text x={i * DAY_PX + DAY_PX / 2} y={34} fontSize={10} textAnchor="middle" fill={isToday(d) ? "var(--primary)" : "var(--text-muted)"} fontWeight={isToday(d) ? 700 : 400}>{format(d, "d")}</text>
              </g>
            );
          })}
          <line x1={0} y1={HEADER} x2={width} y2={HEADER} stroke="var(--border)" />
          {/* dependency links */}
          {rows.map((t) =>
            t.blockedBy.map((d) => {
              const fromRow = rowIndex.get(d.id);
              if (fromRow === undefined) return null;
              const from = rows[fromRow]!;
              const x1 = x(from.dueDate ?? from.startDate!) + DAY_PX;
              const y1 = HEADER + fromRow * ROW + ROW / 2;
              const x2 = x(t.startDate ?? t.dueDate!);
              const y2 = HEADER + rowIndex.get(t.id)! * ROW + ROW / 2;
              return <path key={`${d.id}-${t.id}`} d={`M${x1},${y1} C${x1 + 16},${y1} ${x2 - 16},${y2} ${x2},${y2}`} fill="none" stroke={d.completedAt ? "var(--success)" : "var(--error)"} strokeWidth={1.5} strokeDasharray={d.completedAt ? undefined : "4 3"} opacity={0.8} />;
            }),
          )}
          {/* task bars */}
          {rows.map((t, i) => {
            const s = t.startDate ?? t.dueDate!;
            const e = t.dueDate ?? t.startDate!;
            const bx = x(s);
            const bw = Math.max(DAY_PX, (differenceInCalendarDays(startOfDay(new Date(e)), startOfDay(new Date(s))) + 1) * DAY_PX);
            const y = HEADER + i * ROW + 7;
            const overdue = t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date();
            return (
              <g key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
                <rect x={bx} y={y} width={bw} height={ROW - 14} rx={6} fill={t.completedAt ? "var(--success)" : overdue ? "var(--error)" : t.project.color} opacity={t.completedAt ? 0.5 : 0.9} />
                <text x={bx + 8} y={y + 15} fontSize={11} fill="#fff" fontWeight={500} clipPath={`inset(0 0 0 0)`}>{t.title.length > bw / 7 ? `${t.title.slice(0, Math.max(3, Math.floor(bw / 7) - 1))}…` : t.title}</text>
              </g>
            );
          })}
          {/* milestones */}
          {milestones.map((m) => {
            const mx = x(m.dueDate) + DAY_PX / 2;
            return (
              <g key={m.id}>
                <line x1={mx} y1={HEADER} x2={mx} y2={height} stroke="var(--secondary)" strokeWidth={1.5} strokeDasharray="3 3" />
                <polygon points={`${mx},${HEADER - 10} ${mx + 6},${HEADER - 4} ${mx},${HEADER + 2} ${mx - 6},${HEADER - 4}`} fill={m.completedAt ? "var(--success)" : "var(--secondary)"} />
              </g>
            );
          })}
        </svg>
        {milestones.map((m) => (
          <Tooltip key={m.id} content={`${m.title} · ${format(new Date(m.dueDate), "MMM d")}`}>
            <span className="absolute top-1 flex items-center gap-1 rounded bg-secondary-soft px-1 text-[10px] font-medium text-secondary" style={{ left: x(m.dueDate) + DAY_PX / 2 + 8 }}>
              <Flag className="size-3" /> {m.title}
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
