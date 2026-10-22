"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { post, errorMessage, type TaskDto, type DocumentDto } from "@/lib/api";
import { useWorkspaceTasks, useDocuments, useProjects, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import type { CanvasObject } from "@collabspace/shared/canvas";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";

export function TaskPickerDialog({ onPick, onClose }: { onPick: (task: TaskDto) => void; onClose: () => void }) {
  const { workspace } = useApp();
  const [q, setQ] = useState("");
  const tasks = useWorkspaceTasks(workspace?.id, { q: q || undefined, limit: 50 });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a task card</DialogTitle>
          <DialogDescription>Pick an existing task to show on the canvas. The card stays in sync with the task.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="pl-8" />
        </div>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {tasks.data?.tasks.map((t) => (
            <li key={t.id}>
              <button onClick={() => onPick(t)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                <span className="font-mono text-[11px] text-text-muted">{t.key}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <Badge variant="secondary">{t.status.replace("_", " ")}</Badge>
              </button>
            </li>
          ))}
          {tasks.data?.tasks.length === 0 ? <li className="px-3 py-6 text-center text-sm text-text-secondary">No tasks found.</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentPickerDialog({ onPick, onClose }: { onPick: (doc: DocumentDto) => void; onClose: () => void }) {
  const { workspace } = useApp();
  const [q, setQ] = useState("");
  const docs = useDocuments(workspace?.id);
  const list = (docs.data ?? []).filter((d) => !d.archivedAt && (!q || d.title.toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document card</DialogTitle>
          <DialogDescription>Link a document so teammates can open it straight from the canvas.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" className="pl-8" />
        </div>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {list.map((d) => (
            <li key={d.id}>
              <button onClick={() => onPick(d)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                <span>{d.icon ?? "📄"}</span>
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="text-xs text-text-muted">{d.project?.name ?? ""}</span>
              </button>
            </li>
          ))}
          {list.length === 0 ? <li className="px-3 py-6 text-center text-sm text-text-secondary">No documents found.</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function EmbedDialog({ onSubmit, onClose }: { onSubmit: (url: string, title: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const valid = /^https?:\/\/.+/i.test(url.trim());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Embed a link</DialogTitle>
          <DialogDescription>Links are shown as cards and open in a new tab. Untrusted pages are never rendered inline.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(url.trim(), title.trim());
          }}
        >
          <Field label="URL" htmlFor="embed-url">
            <Input id="embed-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Title (optional)" htmlFor="embed-title">
            <Input id="embed-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertToTaskDialog({ canvasId, object, onClose, onConverted }: { canvasId: string; object: CanvasObject; onClose: () => void; onConverted: (task: TaskDto) => void }) {
  const { workspace, user } = useApp();
  const qc = useQueryClient();
  const projects = useProjects(workspace?.id);
  const members = useMembers(workspace?.id);
  const firstLine = (object.text || object.title || "").split("\n")[0]!.slice(0, 200);
  const [title, setTitle] = useState(firstLine);
  const [description, setDescription] = useState(object.text && object.text !== firstLine ? object.text : "");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState(user?.id ?? "");
  const [priority, setPriority] = useState<TaskDto["priority"]>("NONE");
  const [dueDate, setDueDate] = useState("");
  const effective = projectId || projects.data?.[0]?.id || "";
  const convert = useMutation({
    mutationFn: () => post<TaskDto>(`/canvases/${canvasId}/objects/${object.id}/convert-to-task`, { projectId: effective, title: title.trim(), description: description || undefined, assigneeId: assigneeId || null, priority, dueDate: dueDate ? new Date(dueDate).toISOString() : null }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`Created ${t.key}`);
      onConverted(t);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert note into a task</DialogTitle>
          <DialogDescription>The task keeps a link back to this note, and the note shows a marker once converted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title" htmlFor="cv-title">
            <Input id="cv-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="cv-desc">
            <Textarea id="cv-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project">
              <SimpleSelect value={effective} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a project" />
            </Field>
            <Field label="Assignee">
              <SimpleSelect value={assigneeId || "none"} onChange={(v) => setAssigneeId(v === "none" ? "" : v)} options={[{ value: "none", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} />
            </Field>
            <Field label="Priority">
              <SimpleSelect value={priority} onChange={setPriority} options={["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({ value: p as TaskDto["priority"], label: p === "NONE" ? "No priority" : p[0] + p.slice(1).toLowerCase() }))} />
            </Field>
            <Field label="Due date" htmlFor="cv-due">
              <Input id="cv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          {projects.data?.length === 0 ? <p className="text-sm text-warning">Create a project first.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!effective || !title.trim()} loading={convert.isPending} onClick={() => convert.mutate()}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
