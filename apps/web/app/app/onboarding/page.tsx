"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, FileText, PenTool, Sparkles } from "lucide-react";
import { post, patch, errorMessage, type ProjectDto, type CanvasDto, type DocumentDto, type WorkspaceDto } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useTemplates } from "@/lib/queries";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { USER_COLORS } from "@collabspace/shared";

const PURPOSES = ["Product & engineering", "Design", "Marketing", "Operations", "Research", "Personal", "Other"];

export default function OnboardingPage() {
  const { user, refetchMe } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const templates = useTemplates({ kind: "PROJECT" });
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.name ?? "");
  const [color, setColor] = useState(user?.color ?? USER_COLORS[0]);
  const [wsName, setWsName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [invites, setInvites] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [demo, setDemo] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);

  const next = () => setStep((s) => s + 1);

  const saveProfile = async () => {
    setLoading(true);
    try {
      await patch("/users/me", { name: name.trim() || user?.name, color });
      refetchMe();
      next();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const createWorkspace = async () => {
    if (!wsName.trim()) return;
    setLoading(true);
    try {
      const ws = await post<WorkspaceDto>("/workspaces", { name: wsName.trim(), purpose: purpose || undefined, demo });
      setWorkspace(ws);
      await qc.invalidateQueries({ queryKey: ["me"] });
      next();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const sendInvites = async () => {
    const emails = invites.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (!emails.length || !workspace) return next();
    setLoading(true);
    try {
      await post(`/workspaces/${workspace.id}/invitations`, { emails, role: "MEMBER" });
      toast.success(`Invited ${emails.length} teammate${emails.length > 1 ? "s" : ""}`);
      next();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const finish = async (open: "canvas" | "document" | "project") => {
    if (!workspace) return;
    setLoading(true);
    try {
      let project: ProjectDto | null = null;
      if (!demo && (projectName.trim() || templateKey)) {
        project = await post<ProjectDto>(`/workspaces/${workspace.id}/projects`, { name: projectName.trim() || templates.data?.items.find((t) => t.key === templateKey)?.name || "My first project", templateKey: templateKey || undefined });
      }
      await patch("/users/me", { onboardingDone: true });
      await qc.invalidateQueries({ queryKey: ["me"] });
      if (open === "canvas") {
        const c = await post<CanvasDto>("/canvases", { workspaceId: workspace.id, projectId: project?.id ?? null, title: "My first canvas", templateKey: "canvas.brainstorm" });
        router.replace(`/app/${workspace.slug}/canvas/${c.id}`);
      } else if (open === "document") {
        const d = await post<DocumentDto>("/documents", { workspaceId: workspace.id, projectId: project?.id ?? null, title: "Getting started", templateKey: "doc.project-plan" });
        router.replace(`/app/${workspace.slug}/docs/${d.id}`);
      } else {
        router.replace(project ? `/app/${workspace.slug}/projects/${project.id}` : `/app/${workspace.slug}`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
      setLoading(false);
    }
  };

  const steps = ["Profile", "Workspace", "Invite", "Template", "Done"];

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <ol className="flex items-center gap-1.5" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className={cn("h-1.5 w-8 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-surface-3")} aria-current={i === step ? "step" : undefined} title={s} />
          ))}
        </ol>
      </div>
      <Card className="animate-slide-up p-8">
        {step === 0 ? (
          <StepFrame title="Welcome! Let's set up your profile" description="This is how teammates will see you across canvases, documents and chat.">
            <div className="flex items-center gap-5">
              <UserAvatar user={{ name: name || "?", color }} size="xl" />
              <div className="flex-1 space-y-4">
                <Field label="Your name" htmlFor="ob-name">
                  <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-medium">Cursor color</p>
                  <div className="flex flex-wrap gap-2">
                    {USER_COLORS.map((c) => (
                      <button key={c} aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110", color === c && "ring-2 ring-primary")} style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <Actions onNext={saveProfile} loading={loading} />
          </StepFrame>
        ) : null}

        {step === 1 ? (
          <StepFrame title="Create your workspace" description="A workspace holds your team's projects, canvases, documents and conversations.">
            <Field label="Workspace name" htmlFor="ob-ws">
              <Input id="ob-ws" value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Acme Product Team" autoFocus />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">What will you use it for?</p>
              <div className="flex flex-wrap gap-2">
                {PURPOSES.map((p) => (
                  <button key={p} onClick={() => setPurpose(p)} aria-pressed={purpose === p} className={cn("rounded-full border px-3 py-1 text-sm", purpose === p ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-surface-2">
              <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-1 accent-primary" />
              <span className="text-sm">
                <span className="font-medium">Add demo content</span>
                <span className="block text-text-secondary">A sample project, canvases, a document and a meeting with a transcript — clearly labeled [Demo] so you can explore every feature.</span>
              </span>
            </label>
            <Actions onNext={createWorkspace} loading={loading} disabled={!wsName.trim()} />
          </StepFrame>
        ) : null}

        {step === 2 ? (
          <StepFrame title="Invite your teammates" description="Collaboration is better together. You can always invite more people later from Members.">
            <Field label="Email addresses" htmlFor="ob-inv" hint="Separate with commas or new lines.">
              <Textarea id="ob-inv" rows={3} value={invites} onChange={(e) => setInvites(e.target.value)} placeholder="sam@company.com, jordan@company.com" autoFocus />
            </Field>
            <Actions onNext={sendInvites} loading={loading} nextLabel={invites.trim() ? "Send invites" : "Continue"} onSkip={next} skipLabel="Skip — I'll work alone for now" />
          </StepFrame>
        ) : null}

        {step === 3 ? (
          <StepFrame title={demo ? "Your demo content is ready" : "Start from a template"} description={demo ? "We created a sample project with tasks, canvases, a document and a meeting." : "Templates create real tasks, documents, boards and canvases you can edit."}>
            {!demo ? (
              <>
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
                  <TemplateCard selected={!templateKey} onClick={() => setTemplateKey("")} title="Blank project" description="A default board with Backlog → Done" />
                  {templates.data?.items.map((t) => <TemplateCard key={t.key} selected={templateKey === t.key} onClick={() => setTemplateKey(t.key)} title={`${t.icon ?? ""} ${t.name}`} description={`${t.taskCount} tasks · ${t.documentCount} docs · ${t.canvasCount} canvases`} />)}
                </div>
                <Field label="Project name" htmlFor="ob-proj">
                  <Input id="ob-proj" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={templates.data?.items.find((t) => t.key === templateKey)?.name ?? "My first project"} />
                </Field>
              </>
            ) : null}
            <Actions onNext={next} loading={loading} />
          </StepFrame>
        ) : null}

        {step === 4 ? (
          <StepFrame title="You're all set" description="Where would you like to start?">
            <div className="grid gap-3 sm:grid-cols-3">
              <button onClick={() => void finish("canvas")} disabled={loading} className="rounded-xl border border-border p-4 text-left hover:border-primary hover:bg-primary-soft/40">
                <PenTool className="mb-2 size-5 text-primary" />
                <p className="font-medium">Open a canvas</p>
                <p className="text-xs text-text-secondary">Brainstorm with sticky notes</p>
              </button>
              <button onClick={() => void finish("document")} disabled={loading} className="rounded-xl border border-border p-4 text-left hover:border-primary hover:bg-primary-soft/40">
                <FileText className="mb-2 size-5 text-primary" />
                <p className="font-medium">Write a document</p>
                <p className="text-xs text-text-secondary">Plan with your team</p>
              </button>
              <button onClick={() => void finish("project")} disabled={loading} className="rounded-xl border border-border p-4 text-left hover:border-primary hover:bg-primary-soft/40">
                <Sparkles className="mb-2 size-5 text-primary" />
                <p className="font-medium">Go to the project</p>
                <p className="text-xs text-text-secondary">See tasks and the board</p>
              </button>
            </div>
          </StepFrame>
        ) : null}
      </Card>
    </div>
  );
}

function StepFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Actions({ onNext, loading, disabled, nextLabel = "Continue", onSkip, skipLabel }: { onNext: () => void; loading?: boolean; disabled?: boolean; nextLabel?: string; onSkip?: () => void; skipLabel?: string }) {
  return (
    <div className="flex items-center justify-between pt-2">
      {onSkip ? (
        <Button variant="ghost" onClick={onSkip}>
          {skipLabel ?? "Skip"}
        </Button>
      ) : (
        <span />
      )}
      <Button onClick={onNext} loading={loading} disabled={disabled}>
        {nextLabel} <ArrowRight />
      </Button>
    </div>
  );
}

function TemplateCard({ selected, onClick, title, description }: { selected: boolean; onClick: () => void; title: string; description: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cn("relative rounded-lg border p-3 text-left", selected ? "border-primary bg-primary-soft/40" : "border-border hover:bg-surface-2")}>
      {selected ? <Check className="absolute right-2 top-2 size-4 text-primary" /> : null}
      <p className="pr-5 text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
    </button>
  );
}
