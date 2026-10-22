"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { mutations } from "@/lib/queries";
import { errorMessage, type BoardColumnDto, type TaskDto } from "@/lib/api";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox, SimpleSelect } from "@/components/ui/controls";
import { formatDate, PRIORITY_META, statusLabel, cn } from "@/lib/utils";

export function TaskList({ groups, columns, onOpen, readOnly, selectable, selected, onToggleSelect, showProject, invalidateKeys }: { groups: Array<{ key: string; label: string; color?: string; tasks: TaskDto[] }>; columns?: BoardColumnDto[]; onOpen: (id: string) => void; readOnly?: boolean; selectable?: boolean; selected?: Set<string>; onToggleSelect?: (id: string) => void; showProject?: boolean; invalidateKeys: unknown[][] }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => mutations.updateTask(id, body),
    onSuccess: () => invalidateKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key}>
          {groups.length > 1 || g.key !== "all" ? (
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {g.color ? <span className="size-2.5 rounded-full" style={{ background: g.color }} /> : null}
              {g.label} <span className="font-normal">· {g.tasks.length}</span>
            </h3>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  {selectable ? <th className="w-8 px-3 py-2" /> : null}
                  <th className="w-24 px-3 py-2 font-semibold">Key</th>
                  <th className="px-3 py-2 font-semibold">Title</th>
                  {showProject ? <th className="hidden w-36 px-3 py-2 font-semibold lg:table-cell">Project</th> : null}
                  <th className="w-36 px-3 py-2 font-semibold">Status</th>
                  <th className="hidden w-28 px-3 py-2 font-semibold md:table-cell">Priority</th>
                  <th className="hidden w-32 px-3 py-2 font-semibold md:table-cell">Assignee</th>
                  <th className="w-28 px-3 py-2 font-semibold">Due</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {g.tasks.map((t) => {
                  const overdue = t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date();
                  return (
                    <tr key={t.id} className={cn("group cursor-pointer hover:bg-surface-2/60", selected?.has(t.id) && "bg-primary-soft/30")} onClick={() => onOpen(t.id)}>
                      {selectable ? (
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected?.has(t.id)} onCheckedChange={() => onToggleSelect?.(t.id)} aria-label="Select task" />
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{t.key}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Checkbox checked={Boolean(t.completedAt)} disabled={readOnly} onClick={(e) => e.stopPropagation()} onCheckedChange={(v) => update.mutate({ id: t.id, body: { completed: v === true } })} aria-label="Complete task" />
                          <span className={cn("truncate font-medium", t.completedAt && "text-text-muted line-through")}>{t.title}</span>
                          {t.blocked ? <AlertTriangle className="size-3.5 shrink-0 text-error" aria-label="Blocked" /> : null}
                          {t.labels.slice(0, 2).map((l) => (
                            <span key={l.id} className="hidden rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white sm:inline" style={{ background: l.color }}>
                              {l.name}
                            </span>
                          ))}
                          {t.subtaskCount ? <span className="text-[11px] text-text-muted">{t.subtaskCount} sub</span> : null}
                        </div>
                      </td>
                      {showProject ? (
                        <td className="hidden px-3 py-2 lg:table-cell">
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="size-2 rounded-full" style={{ background: t.project.color }} /> {t.project.name}
                          </span>
                        </td>
                      ) : null}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {columns && !readOnly ? (
                          <SimpleSelect value={t.status} onChange={(status) => update.mutate({ id: t.id, body: { status } })} options={columns.map((c) => ({ value: c.statusKey, label: c.name }))} className="h-7 w-32 text-xs" />
                        ) : (
                          <Badge variant="secondary">{statusLabel(t.status)}</Badge>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell" onClick={(e) => e.stopPropagation()}>
                        {!readOnly ? (
                          <SimpleSelect value={t.priority} onChange={(priority) => update.mutate({ id: t.id, body: { priority } })} options={["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({ value: p, label: PRIORITY_META[p]!.label }))} className="h-7 w-28 text-xs" />
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="size-2 rounded-full" style={{ background: PRIORITY_META[t.priority]!.color }} /> {PRIORITY_META[t.priority]!.label}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        {t.assignee ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <UserAvatar user={t.assignee} size="xs" /> <span className="truncate">{t.assignee.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                      <td className={cn("px-3 py-2 text-xs", overdue ? "font-medium text-error" : "text-text-secondary")}>{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                      <td className="px-3 py-2 text-text-muted">
                        <ChevronRight className="size-4 opacity-0 group-hover:opacity-100" />
                      </td>
                    </tr>
                  );
                })}
                {g.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-text-secondary">
                      No tasks.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
