"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { post, errorMessage, type CanvasDto, type DocumentDto, type ProjectDto, type TaskDto } from "@/lib/api";
import { useProjects, useTemplates, useMembers } from "@/lib/queries";
import { useApp } from "./workspace-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";

type Kind = "canvas" | "document" | "project" | "task" | "invite" | null;

interface Ctx {
  openCanvas: (projectId?: string) => void;
  openDocument: (projectId?: string) => void;
  openProject: () => void;
  openTask: (projectId?: string, defaults?: Partial<{ title: string; status: string }>) => void;
  openInvite: () => void;
}

const CreateCtx = createContext<Ctx | null>(null);

export function useCreateDialogs(): Ctx {
  const ctx = useContext(CreateCtx);
  if (!ctx) throw new Error("useCreateDialogs outside provider");
  return ctx;
}

export function CreateDialogsProvider({ children }: { children: React.ReactNode }) {
  const [kind, setKind] = useState<Kind>(null);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [defaults, setDefaults] = useState<Partial<{ title: string; status: string }>>({});
  const value = useMemo<Ctx>(
    () => ({
      openCanvas: (p) => {
        setProjectId(p);
        setKind("canvas");
      },
      openDocument: (p) => {
        setProjectId(p);
        setKind("document");
      },
      openProject: () => setKind("project"),
      openTask: (p, d) => {
        setProjectId(p);
        setDefaults(d ?? {});
        setKind("task");
      },
      openInvite: () => setKind("invite"),
    }),
    [],
  );
  const close = useCallback(() => setKind(null), []);
  return (
    <CreateCtx.Provider value={value}>
      {children}
      {kind === "canvas" || kind === "document" ? <CreateResourceDialog kind={kind} projectId={projectId} onClose={close} /> : null}
      {kind === "project" ? <CreateProjectDialog onClose={close} /> : null}
      {kind === "task" ? <CreateTaskDialog projectId={projectId} defaults={defaults} onClose={close} /> : null}
      {kind === "invite" ? <InviteDialog onClose={close} /> : null}
    </CreateCtx.Provider>
  );
}

function CreateResourceDialog({ kind, projectId: initialProject, onClose }: { kind: "canvas" | "document"; projectId?: string; onClose: () => void }) {
  const { workspace, workspaceSlug } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useProjects(workspace?.id);
  const templates = useTemplates({ kind: kind === "canvas" ? "CANVAS" : "DOCUMENT" });
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>(initialProject ?? "");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [visibility, setVisibility] = useState<"WORKSPACE" | "PRIVATE">("WORKSPACE");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const body = { workspaceId: workspace.id, projectId: projectId || null, title: title.trim() || (kind === "canvas" ? "Untitled canvas" : "Untitled document"), templateKey: templateKey || undefined, visibility };
      const res = kind === "canvas" ? await post<CanvasDto>("/canvases", body) : await post<DocumentDto>("/documents", body);
      void qc.invalidateQueries({ queryKey: [kind === "canvas" ? "canvases" : "documents"] });
      onClose();
      router.push(`/app/${workspaceSlug}/${kind === "canvas" ? "canvas" : "docs"}/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind}</DialogTitle>
          <DialogDescription>{kind === "canvas" ? "An infinite board for sticky notes, shapes and diagrams." : "A collaborative rich-text document."}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Title" htmlFor="res-title">
            <Input id="res-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "canvas" ? "Q3 planning board" : "Design proposal"} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project">
              <SimpleSelect value={projectId || "none"} onChange={(v) => setProjectId(v === "none" ? "" : v)} options={[{ value: "none", label: "No project" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
            <Field label="Visibility">
              <SimpleSelect value={visibility} onChange={setVisibility} options={[{ value: "WORKSPACE", label: "Everyone in workspace" }, { value: "PRIVATE", label: "Only me & people I share with" }]} />
            </Field>
          </div>
          <Field label="Start from a template" hint="Templates create real editable content you can change.">
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
              <TemplateOption selected={!templateKey} onClick={() => setTemplateKey("")} name="Blank" description={kind === "canvas" ? "Empty canvas" : "Empty document"} />
              {templates.data?.items.map((t) => <TemplateOption key={t.key} selected={templateKey === t.key} onClick={() => setTemplateKey(t.key)} name={t.name} description={t.description} />)}
            </div>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create {kind}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateOption({ selected, onClick, name, description }: { selected: boolean; onClick: () => void; name: string; description: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary bg-primary-soft/50" : "border-border hover:bg-surface-2"}`}>
      <p className="text-sm font-medium">{name}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{description}</p>
    </button>
  );
}

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const { workspace, workspaceSlug } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const templates = useTemplates({ kind: "PROJECT" });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [visibility, setVisibility] = useState<"WORKSPACE" | "PRIVATE">("WORKSPACE");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!workspace || !name.trim()) return;
    setLoading(true);
    try {
      const p = await post<ProjectDto>(`/workspaces/${workspace.id}/projects`, { name: name.trim(), description: description || undefined, templateKey: templateKey || undefined, visibility });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      router.push(`/app/${workspaceSlug}/projects/${p.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Projects group tasks, documents, canvases and meetings.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" htmlFor="proj-name">
            <Input id="proj-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Website redesign" required />
          </Field>
          <Field label="Description" htmlFor="proj-desc">
            <Textarea id="proj-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" rows={2} />
          </Field>
          <Field label="Visibility">
            <SimpleSelect value={visibility} onChange={setVisibility} options={[{ value: "WORKSPACE", label: "Everyone in workspace" }, { value: "PRIVATE", label: "Only project members" }]} />
          </Field>
          <Field label="Template" hint="Templates create real tasks, documents, boards and canvases.">
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
              <TemplateOption selected={!templateKey} onClick={() => setTemplateKey("")} name="Blank project" description="Default board with Backlog → Done" />
              {templates.data?.items.map((t) => <TemplateOption key={t.key} selected={templateKey === t.key} onClick={() => setTemplateKey(t.key)} name={`${t.icon ?? ""} ${t.name}`} description={`${t.taskCount} tasks · ${t.documentCount} docs · ${t.canvasCount} canvases`} />)}
            </div>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!name.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskDialog({ projectId: initial, defaults, onClose }: { projectId?: string; defaults: Partial<{ title: string; status: string }>; onClose: () => void }) {
  const { workspace, user } = useApp();
  const qc = useQueryClient();
  const projects = useProjects(workspace?.id);
  const members = useMembers(workspace?.id);
  const [projectId, setProjectId] = useState(initial ?? "");
  const [title, setTitle] = useState(defaults.title ?? "");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskDto["priority"]>("NONE");
  const [assigneeId, setAssigneeId] = useState<string>(user?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const effectiveProject = projectId || projects.data?.[0]?.id || "";

  const submit = async () => {
    if (!effectiveProject || !title.trim()) return;
    setLoading(true);
    try {
      const t = await post<TaskDto>(`/projects/${effectiveProject}/tasks`, { title: title.trim(), description: description || undefined, priority, assigneeId: assigneeId || null, dueDate: dueDate ? new Date(dueDate).toISOString() : null, status: defaults.status });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
      toast.success(`Created ${t.key}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Title" htmlFor="task-title">
            <Input id="task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" required />
          </Field>
          <Field label="Description" htmlFor="task-desc">
            <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Add details, context or acceptance criteria" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project">
              <SimpleSelect value={effectiveProject} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Select a project" />
            </Field>
            <Field label="Priority">
              <SimpleSelect value={priority} onChange={setPriority} options={["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({ value: p as TaskDto["priority"], label: p === "NONE" ? "No priority" : p[0] + p.slice(1).toLowerCase() }))} />
            </Field>
            <Field label="Assignee">
              <SimpleSelect value={assigneeId || "none"} onChange={(v) => setAssigneeId(v === "none" ? "" : v)} options={[{ value: "none", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} />
            </Field>
            <Field label="Due date" htmlFor="task-due">
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          {projects.data && projects.data.length === 0 ? <p className="text-sm text-warning">Create a project first to add tasks.</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!effectiveProject || !title.trim()}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "GUEST">("MEMBER");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ email: string; status: string; inviteUrl?: string }> | null>(null);
  const submit = async () => {
    if (!workspace) return;
    const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (!list.length) return;
    setLoading(true);
    try {
      const res = await post<Array<{ email: string; status: string; inviteUrl?: string }>>(`/workspaces/${workspace.id}/invitations`, { emails: list, role });
      setResults(res);
      void qc.invalidateQueries({ queryKey: ["invitations", workspace.id] });
      toast.success(`Sent ${res.filter((r) => r.status === "sent").length} invitation(s)`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite teammates</DialogTitle>
          <DialogDescription>They&apos;ll receive an email with a link to join {workspace?.name}.</DialogDescription>
        </DialogHeader>
        {results ? (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.email} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.email}</span>
                  <span className={r.status === "sent" ? "text-success" : "text-text-muted"}>{r.status === "sent" ? "Invitation sent" : "Already a member"}</span>
                </div>
                {r.inviteUrl ? (
                  <p className="mt-1 break-all text-xs text-text-muted">
                    Dev link: <code>{r.inviteUrl}</code>
                  </p>
                ) : null}
              </div>
            ))}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Email addresses" htmlFor="inv-emails" hint="Separate multiple addresses with commas or new lines.">
              <Textarea id="inv-emails" autoFocus value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="sam@company.com, jordan@company.com" />
            </Field>
            <Field label="Role">
              <SimpleSelect value={role} onChange={setRole} options={[{ value: "MEMBER", label: "Member — can create and edit" }, { value: "ADMIN", label: "Admin — can manage members and settings" }, { value: "GUEST", label: "Guest — only sees what is shared with them" }]} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Send invitations
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
