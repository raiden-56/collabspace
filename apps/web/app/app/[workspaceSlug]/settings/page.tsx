"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, ShieldAlert, Trash2, X, Zap } from "lucide-react";
import { get, patch, post, del, errorMessage, type AutomationRuleDto, type AutomationExecutionDto } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { useLabels } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect, Switch } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/skeleton";
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { formatDate } from "@/lib/utils";

const TRIGGERS = [
  { value: "task.assigned", label: "Task assigned" },
  { value: "task.overdue", label: "Task becomes overdue" },
  { value: "task.status_changed", label: "Task status changed" },
  { value: "task.subtasks_complete", label: "All subtasks complete" },
  { value: "meeting.ended", label: "Meeting ends" },
  { value: "resource.shared", label: "Resource shared with someone" },
];
const ACTIONS = [
  { value: "notify", label: "Send a notification" },
  { value: "suggest_status", label: "Suggest a status change (needs approval)" },
  { value: "set_status", label: "Change status (needs approval)" },
  { value: "add_label", label: "Add a label" },
  { value: "draft_summary", label: "Prepare an AI draft summary (meetings)" },
];

function SettingsContent() {
  const { workspace, canManage } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  useHeader({ title: "Workspace settings" });
  const [tab, setTab] = useState<"general" | "automation" | "danger">((params.get("tab") as "general") ?? "general");
  useEffect(() => {
    const t = params.get("tab");
    if (t === "automation" || t === "general" || t === "danger") setTab(t);
  }, [params]);
  if (!workspace) return null;
  if (!canManage)
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center text-text-secondary">
        Only workspace admins can change settings.{" "}
        <button className="text-primary underline" onClick={() => router.back()}>
          Go back
        </button>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader title="Workspace settings" description={workspace.name} />
      <SegmentTabs value={tab} onChange={(v) => { setTab(v); router.replace(`?tab=${v}`); }} options={[{ value: "general", label: "General" }, { value: "automation", label: "Automation" }, { value: "danger", label: "Danger zone" }]} className="mb-6" />
      {tab === "general" ? <General /> : tab === "automation" ? <Automation highlightExecution={params.get("execution")} /> : <Danger />}
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}

function General() {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: workspace!.name, description: workspace!.description ?? "", purpose: workspace!.purpose ?? "" });
  const save = useMutation({
    mutationFn: () => patch(`/workspaces/${workspace!.id}`, { name: form.name, description: form.description || null, purpose: form.purpose || null }),
    onSuccess: () => {
      toast.success("Workspace updated");
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const labels = useLabels(workspace?.id);
  const [labelName, setLabelName] = useState("");
  const addLabel = useMutation({ mutationFn: () => post(`/workspaces/${workspace!.id}/labels`, { name: labelName.trim() }), onSuccess: () => { setLabelName(""); void qc.invalidateQueries({ queryKey: ["labels"] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const removeLabel = useMutation({ mutationFn: (id: string) => del(`/workspaces/${workspace!.id}/labels/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["labels"] }), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold">Profile</h2>
        <div className="space-y-4">
          <Field label="Workspace name" htmlFor="ws-name">
            <Input id="ws-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Slug" hint="Used in URLs. Contact support to change it.">
            <Input value={`/app/${workspace!.slug}`} readOnly className="bg-surface-2" />
          </Field>
          <Field label="Description" htmlFor="ws-desc">
            <Textarea id="ws-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Purpose" htmlFor="ws-purpose">
            <Input id="ws-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Product & engineering" />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold">Task labels</h2>
        <p className="mb-4 text-sm text-text-secondary">Labels are shared across all projects in this workspace.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {labels.data?.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
              <span className="size-2 rounded-full" style={{ background: l.color }} /> {l.name}
              <button onClick={() => removeLabel.mutate(l.id)} className="ml-1 text-text-muted hover:text-error" aria-label={`Delete label ${l.name}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (labelName.trim()) addLabel.mutate();
          }}
        >
          <Input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="New label name" className="max-w-xs" />
          <Button type="submit" variant="outline" disabled={!labelName.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Automation({ highlightExecution }: { highlightExecution: string | null }) {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const data = useQuery<{ rules: AutomationRuleDto[]; pending: AutomationExecutionDto[] }>({ queryKey: ["automation", workspace?.id], queryFn: () => get(`/workspaces/${workspace!.id}/automation/rules`) });
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["automation"] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => patch(`/automation/rules/${id}`, { enabled }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/automation/rules/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const resolve = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => post(`/automation/executions/${id}/resolve`, { approve }), onSuccess: () => { refresh(); toast.success("Done"); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="space-y-6">
      {data.data?.pending.length ? (
        <Card className="border-warning/40 p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-warning" /> Waiting for approval
          </h2>
          <p className="mb-3 text-xs text-text-secondary">These automations have meaningful consequences and need a human decision.</p>
          <ul className="divide-y divide-border">
            {data.data.pending.map((ex) => {
              const te = ex.triggerEvent as { resourceTitle?: string; trigger?: string };
              return (
                <li key={ex.id} className={`flex items-center gap-3 py-2 text-sm ${highlightExecution === ex.id ? "rounded-md bg-warning-soft px-2" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{ex.rule?.name}</p>
                    <p className="text-xs text-text-muted">
                      {te.resourceTitle ? `“${te.resourceTitle}” · ` : ""}
                      {te.trigger} · {formatDate(ex.createdAt, true)}
                    </p>
                  </div>
                  <Button size="sm" variant="subtle" onClick={() => resolve.mutate({ id: ex.id, approve: true })}>
                    <Check /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: ex.id, approve: false })}>
                    <X /> Reject
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Rules</h2>
            <p className="text-xs text-text-secondary">Simple when-this-then-that rules. Built-in rules can be turned on or off; custom rules can be edited.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> New rule
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {data.data?.rules.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-3">
              <Switch checked={r.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: r.id, enabled })} aria-label={`Enable ${r.name}`} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {r.name} {r.isBuiltIn ? <Badge variant="secondary">built-in</Badge> : null} {r.requiresApproval ? <Badge variant="warning">approval</Badge> : null}
                </p>
                <p className="text-xs text-text-secondary">{r.description}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  When <code>{r.trigger}</code> → {r.actions.map((a) => String(a.type)).join(", ")} · {r._count?.executions ?? 0} runs
                </p>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setHistory(r.id)}>
                History
              </Button>
              {!r.isBuiltIn ? (
                <Button size="icon-xs" variant="ghost" aria-label="Delete rule" onClick={() => remove.mutate(r.id)}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {open ? <NewRuleDialog onClose={() => setOpen(false)} onCreated={refresh} /> : null}
      {history ? <HistoryDialog ruleId={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

function NewRuleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { workspace } = useApp();
  const labels = useLabels(workspace?.id);
  const [form, setForm] = useState({ name: "", description: "", trigger: "task.assigned", actionType: "notify", target: "assignee", status: "in_review", labelId: "", requiresApproval: false });
  const create = useMutation({
    mutationFn: () => {
      const action = form.actionType === "notify" ? { type: "notify", target: form.target } : form.actionType === "add_label" ? { type: "add_label", labelId: form.labelId } : form.actionType === "draft_summary" ? { type: "draft_summary" } : { type: form.actionType, status: form.status };
      return post(`/workspaces/${workspace!.id}/automation/rules`, { name: form.name, description: form.description || undefined, trigger: form.trigger, actions: [action], requiresApproval: form.requiresApproval, enabled: true });
    },
    onSuccess: () => {
      toast.success("Rule created");
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New automation rule</DialogTitle>
          <DialogDescription>Rules run on the server with loop prevention and retries. Actions with consequences require approval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="rule-name">
            <Input id="rule-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Notify lead when a task is overdue" autoFocus />
          </Field>
          <Field label="Description" htmlFor="rule-desc">
            <Input id="rule-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="When">
              <SimpleSelect value={form.trigger} onChange={(v) => setForm({ ...form, trigger: v })} options={TRIGGERS} />
            </Field>
            <Field label="Then">
              <SimpleSelect value={form.actionType} onChange={(v) => setForm({ ...form, actionType: v })} options={ACTIONS} />
            </Field>
            {form.actionType === "notify" ? (
              <Field label="Notify">
                <SimpleSelect value={form.target} onChange={(v) => setForm({ ...form, target: v })} options={[{ value: "assignee", label: "Assignee" }, { value: "reporter", label: "Reporter" }, { value: "project_lead", label: "Project lead" }, { value: "actor", label: "Person who triggered it" }]} />
              </Field>
            ) : null}
            {form.actionType === "suggest_status" || form.actionType === "set_status" ? (
              <Field label="Status key" htmlFor="rule-status">
                <Input id="rule-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} placeholder="in_review" />
              </Field>
            ) : null}
            {form.actionType === "add_label" ? (
              <Field label="Label">
                <SimpleSelect value={form.labelId || undefined} onChange={(v) => setForm({ ...form, labelId: v })} placeholder="Choose a label" options={(labels.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
              </Field>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.requiresApproval} onCheckedChange={(v) => setForm({ ...form, requiresApproval: v })} /> Require approval before running
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.name.trim() || (form.actionType === "add_label" && !form.labelId)} loading={create.isPending} onClick={() => create.mutate()}>
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const q = useQuery<AutomationExecutionDto[]>({ queryKey: ["automation-executions", ruleId], queryFn: () => get(`/automation/rules/${ruleId}/executions`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Execution history</DialogTitle>
        </DialogHeader>
        {q.data?.length === 0 ? <p className="text-sm text-text-secondary">This rule has not run yet.</p> : null}
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {q.data?.map((ex) => {
            const te = ex.triggerEvent as { resourceTitle?: string };
            return (
              <li key={ex.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{te.resourceTitle ?? "—"}</span>
                  <Badge variant={ex.status === "SUCCEEDED" ? "success" : ex.status === "FAILED" ? "error" : ex.status === "PENDING_APPROVAL" ? "warning" : "secondary"}>{ex.status.toLowerCase().replace("_", " ")}</Badge>
                </div>
                <p className="text-xs text-text-muted">
                  {formatDate(ex.createdAt, true)} · attempt {ex.attempts}
                  {ex.error ? ` · ${ex.error}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function Danger() {
  const { workspace } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/workspaces/${workspace!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/app");
      toast.success("Workspace deleted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="border-error/40 p-6">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-error">
        <ShieldAlert className="size-4" /> Delete workspace
      </h2>
      <p className="mb-4 text-sm text-text-secondary">All projects, canvases, documents, tasks, conversations and files in this workspace will become inaccessible. Only the owner can do this.</p>
      <Button variant="destructive" disabled={workspace?.role !== "OWNER"} onClick={() => setConfirm(true)}>
        <Trash2 /> Delete {workspace?.name}
      </Button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${workspace?.name}?`} description="This cannot be undone." confirmLabel="Delete workspace" destructive onConfirm={() => remove.mutate()} />
    </Card>
  );
}
