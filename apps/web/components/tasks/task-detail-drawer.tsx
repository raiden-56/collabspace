"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Calendar, CheckSquare, Link2, Paperclip, Plus, Trash2, X, ExternalLink, GitBranch, Archive } from "lucide-react";
import { post, patch, del, uploadFile, errorMessage, type TaskDto } from "@/lib/api";
import { useTask, useMembers, useLabels, useProjectTasks } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { SimpleSelect, Checkbox } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/skeleton";
import { Dialog, SheetContent, ConfirmDialog, Tooltip } from "@/components/ui/overlays";
import { CommentThreads } from "@/components/comments/comment-thread";
import { formatDate, timeAgo, statusLabel, PRIORITY_META, cn, formatBytes } from "@/lib/utils";
import { activityLabel } from "@/components/shared/resource-link";

export function TaskDetailDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(taskId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0">{taskId ? <TaskDetail taskId={taskId} onClose={onClose} /> : null}</SheetContent>
    </Dialog>
  );
}

function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { workspace, workspaceSlug, user } = useApp();
  const qc = useQueryClient();
  const task = useTask(taskId);
  const members = useMembers(workspace?.id);
  const labels = useLabels(workspace?.id);
  const t = task.data;
  const canEdit = t?.access === "OWNER" || t?.access === "EDITOR";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newSub, setNewSub] = useState("");
  const [depPick, setDepPick] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const siblings = useProjectTasks(t?.projectId, { limit: 300 });

  useEffect(() => {
    if (t) {
      setTitle(t.title);
      setDescription(t.description);
    }
  }, [t?.id, t?.title, t?.description, t]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["task", taskId] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["board"] });
  };
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => patch<TaskDto>(`/tasks/${taskId}`, body), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });
  const addSub = useMutation({ mutationFn: () => post(`/projects/${t!.projectId}/tasks`, { title: newSub.trim(), parentId: taskId }), onSuccess: () => { setNewSub(""); invalidate(); }, onError: (e) => toast.error(errorMessage(e)) });
  const addDep = useMutation({ mutationFn: (dependsOnTaskId: string) => post(`/tasks/${taskId}/dependencies`, { dependsOnTaskId, type: "BLOCKS" }), onSuccess: () => { setDepPick(""); invalidate(); }, onError: (e) => toast.error(errorMessage(e)) });
  const removeDep = useMutation({ mutationFn: (id: string) => del(`/tasks/${taskId}/dependencies/${id}`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => del(`/tasks/${taskId}`), onSuccess: () => { invalidate(); onClose(); toast.success("Task deleted"); }, onError: (e) => toast.error(errorMessage(e)) });
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const asset = await uploadFile(file, { workspaceId: t!.workspaceId, projectId: t!.projectId, resourceType: "TASK", resourceId: taskId });
      await post(`/tasks/${taskId}/attachments`, { fileId: asset.id });
    },
    onSuccess: () => { invalidate(); toast.success("Attachment added"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!t) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const overdue = t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date();
  const sourceHref = t.sourceType === "canvas-note" && t.sourceMeta?.canvasId ? `/app/${workspaceSlug}/canvas/${t.sourceMeta.canvasId}` : t.sourceType === "doc-item" && t.sourceMeta?.documentId ? `/app/${workspaceSlug}/docs/${t.sourceMeta.documentId}` : t.sourceType === "meeting-action" && t.sourceMeta?.meetingId ? `/app/${workspaceSlug}/meetings/${t.sourceMeta.meetingId}` : null;
  const depCandidates = (siblings.data?.tasks ?? []).filter((s) => s.id !== taskId && !t.blockedBy.some((d) => d.id === s.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Link href={`/app/${workspaceSlug}/projects/${t.projectId}`} className="font-mono text-xs text-text-muted hover:text-text">{t.key}</Link>
        <span className="size-1 rounded-full bg-text-muted" />
        <span className="text-xs text-text-muted">{t.project.name}</span>
        {t.blocked ? <Badge variant="error"><AlertTriangle className="size-3" /> Blocked</Badge> : null}
        {t.parent ? <Badge variant="secondary">Subtask of {t.parent.number}</Badge> : null}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content="Copy link">
            <Button variant="ghost" size="icon-xs" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/app/${workspaceSlug}/tasks?task=${t.id}`); toast.success("Link copied"); }}><Link2 /></Button>
          </Tooltip>
          {canEdit ? (
            <>
              <Tooltip content={t.archivedAt ? "Unarchive" : "Archive"}>
                <Button variant="ghost" size="icon-xs" aria-label="Archive" onClick={() => update.mutate({ archived: !t.archivedAt })}><Archive /></Button>
              </Tooltip>
              <Tooltip content="Delete">
                <Button variant="ghost" size="icon-xs" aria-label="Delete task" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
              </Tooltip>
            </>
          ) : null}
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}><X /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="space-y-6 p-5">
          <div className="flex items-start gap-3">
            <button aria-label={t.completedAt ? "Mark incomplete" : "Mark complete"} disabled={!canEdit} onClick={() => update.mutate({ completed: !t.completedAt })} className={cn("mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors", t.completedAt ? "border-success bg-success text-white" : "border-border-strong hover:border-primary")}>
              {t.completedAt ? <CheckSquare className="size-3.5" /> : null}
            </button>
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && update.mutate({ title: title.trim() })} readOnly={!canEdit} rows={1} className={cn("w-full resize-none bg-transparent text-xl font-semibold leading-snug outline-none", t.completedAt && "text-text-muted line-through")} aria-label="Task title" onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Prop label="Status">
              <SimpleSelect value={t.status} disabled={!canEdit} onChange={(status) => update.mutate({ status })} options={t.columns.map((c) => ({ value: c.statusKey, label: c.name }))} className="h-8 text-xs" />
            </Prop>
            <Prop label="Assignee">
              <SimpleSelect value={t.assigneeId ?? "none"} disabled={!canEdit} onChange={(v) => update.mutate({ assigneeId: v === "none" ? null : v })} options={[{ value: "none", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} className="h-8 text-xs" />
            </Prop>
            <Prop label="Priority">
              <SimpleSelect value={t.priority} disabled={!canEdit} onChange={(priority) => update.mutate({ priority })} options={["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({ value: p, label: PRIORITY_META[p]!.label }))} className="h-8 text-xs" />
            </Prop>
            <Prop label="Due date">
              <div className="flex items-center gap-1">
                <Input type="date" disabled={!canEdit} value={t.dueDate ? t.dueDate.slice(0, 10) : ""} onChange={(e) => update.mutate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} className={cn("h-8 text-xs", overdue && "border-error text-error")} />
                {overdue ? <span className="text-[11px] text-error">overdue</span> : null}
              </div>
            </Prop>
            <Prop label="Start date">
              <Input type="date" disabled={!canEdit} value={t.startDate ? t.startDate.slice(0, 10) : ""} onChange={(e) => update.mutate({ startDate: e.target.value ? new Date(e.target.value).toISOString() : null })} className="h-8 text-xs" />
            </Prop>
            <Prop label="Estimate (hours)">
              <Input type="number" min={0} step={0.5} disabled={!canEdit} defaultValue={t.estimate ?? ""} onBlur={(e) => update.mutate({ estimate: e.target.value ? Number(e.target.value) : null })} className="h-8 text-xs" />
            </Prop>
            <Prop label="Labels" className="sm:col-span-2">
              <div className="flex flex-wrap gap-1">
                {(labels.data ?? []).map((l) => {
                  const on = t.labels.some((x) => x.id === l.id);
                  return (
                    <button key={l.id} disabled={!canEdit} aria-pressed={on} onClick={() => update.mutate({ labelIds: on ? t.labels.filter((x) => x.id !== l.id).map((x) => x.id) : [...t.labels.map((x) => x.id), l.id] })} className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", on ? "border-transparent text-white" : "border-border text-text-secondary hover:bg-surface-2")} style={on ? { background: l.color } : undefined}>
                      {l.name}
                    </button>
                  );
                })}
                {labels.data?.length === 0 ? <span className="text-xs text-text-muted">No labels yet — create them in workspace settings.</span> : null}
              </div>
            </Prop>
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">Description</h3>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== t.description && update.mutate({ description })} readOnly={!canEdit} rows={4} placeholder="Add details, context, acceptance criteria…" className="text-sm" />
          </section>

          {sourceHref ? (
            <Link href={sourceHref} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs hover:bg-surface-3">
              <ExternalLink className="size-3.5 text-primary" />
              Created from {t.sourceType === "canvas-note" ? `a sticky note on “${t.sourceMeta?.canvasTitle}”` : t.sourceType === "doc-item" ? `a checklist item in “${t.sourceMeta?.documentTitle}”` : `an action item in meeting “${t.sourceMeta?.meetingTitle}”`} →
            </Link>
          ) : null}

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><CheckSquare className="size-3.5" /> Subtasks ({t.subtasks.filter((s) => s.completedAt).length}/{t.subtasks.length})</h3>
            <ul className="space-y-1">
              {t.subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-2">
                  <Checkbox checked={Boolean(s.completedAt)} disabled={!canEdit} onCheckedChange={(v) => patch(`/tasks/${s.id}`, { completed: v === true }).then(invalidate)} aria-label={`Complete ${s.title}`} />
                  <Link href={`/app/${workspaceSlug}/tasks?task=${s.id}`} className={cn("flex-1 truncate", s.completedAt && "text-text-muted line-through")}>{s.title}</Link>
                  {s.assignee ? <UserAvatar user={s.assignee} size="xs" /> : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newSub.trim()) addSub.mutate(); }}>
                <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask…" className="h-8 text-xs" />
                <Button type="submit" size="sm" variant="outline" disabled={!newSub.trim()}><Plus /></Button>
              </form>
            ) : null}
          </section>

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><GitBranch className="size-3.5" /> Dependencies</h3>
            {t.blockedBy.length === 0 && t.blocking.length === 0 ? <p className="text-xs text-text-muted">No dependencies.</p> : null}
            {t.blockedBy.length ? (
              <div className="mb-2">
                <p className="mb-1 text-[11px] text-text-muted">Blocked by</p>
                <ul className="space-y-1">
                  {t.blockedBy.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                      <span className={cn("size-2 rounded-full", d.completedAt ? "bg-success" : "bg-error")} />
                      <Link href={`/app/${workspaceSlug}/tasks?task=${d.id}`} className="flex-1 truncate">{d.title}</Link>
                      <Badge variant="secondary">{statusLabel(d.status)}</Badge>
                      {canEdit ? <button onClick={() => removeDep.mutate(d.id)} className="text-text-muted hover:text-error" aria-label="Remove dependency"><X className="size-3.5" /></button> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {t.blocking.length ? (
              <div className="mb-2">
                <p className="mb-1 text-[11px] text-text-muted">Blocks</p>
                <ul className="space-y-1">
                  {t.blocking.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                      <Link href={`/app/${workspaceSlug}/tasks?task=${d.id}`} className="flex-1 truncate">{d.title}</Link>
                      <Badge variant="secondary">{statusLabel(d.status)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canEdit ? (
              <div className="flex gap-2">
                <SimpleSelect value={depPick || undefined} onChange={setDepPick} placeholder="This task is blocked by…" options={depCandidates.map((s) => ({ value: s.id, label: `${s.key} ${s.title}` }))} className="h-8 flex-1 text-xs" />
                <Button size="sm" variant="outline" disabled={!depPick} loading={addDep.isPending} onClick={() => addDep.mutate(depPick)}>Add</Button>
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><Paperclip className="size-3.5" /> Attachments</h3>
            <ul className="space-y-1">
              {t.attachments.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                  <a href={`/api/v1/files/${f.id}/download`} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline">{f.name}</a>
                  <span className="text-[11px] text-text-muted">{formatBytes(f.sizeBytes)}</span>
                  {canEdit ? <button onClick={() => del(`/tasks/${taskId}/attachments/${f.id}`).then(invalidate)} className="text-text-muted hover:text-error" aria-label="Remove attachment"><X className="size-3.5" /></button> : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <label className={cn("mt-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-2", attach.isPending && "opacity-50")}>
                <Paperclip className="size-3.5" /> {attach.isPending ? "Uploading…" : "Attach file"}
                <input type="file" className="sr-only" disabled={attach.isPending} onChange={(e) => e.target.files?.[0] && attach.mutate(e.target.files[0])} />
              </label>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Comments</h3>
            <CommentThreads resourceType="TASK" resourceId={taskId} canComment={Boolean(t.access && t.access !== null)} compact />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Activity</h3>
            <ul className="space-y-2">
              {t.activities.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-xs">
                  <UserAvatar user={a.actor} size="xs" className="mt-0.5" />
                  <span className="text-text-secondary">
                    <span className="font-medium text-text">{a.actor?.name ?? "System"}</span> {activityLabel(`task.${a.type}`, a.payload)} <span className="text-text-muted">· {timeAgo(a.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-text-muted">
              Created {formatDate(t.createdAt, true)} by {t.reporter.name} · updated {timeAgo(t.updatedAt)}
            </p>
          </section>
        </div>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${t.key}?`} description="Subtasks will be kept but detached. This cannot be undone." confirmLabel="Delete" destructive onConfirm={() => remove.mutate()} />
      <span className="sr-only">{user?.name}</span>
    </div>
  );
}

function Prop({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</p>
      {children}
    </div>
  );
}

export { Calendar };
