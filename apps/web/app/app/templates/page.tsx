"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, FolderKanban, LayoutTemplate, PenTool, Search } from "lucide-react";
import { post, errorMessage, type TemplateDto } from "@/lib/api";
import { useTemplates, useProjects } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { useUiStore } from "@/lib/stores/ui-store";

const KIND_ICON = { CANVAS: PenTool, DOCUMENT: FileText, PROJECT: FolderKanban } as const;

export default function TemplatesPage() {
  useHeader({ title: "Templates" });
  const { me, workspace, isGuest } = useApp();
  const lastSlug = useUiStore((s) => s.lastWorkspaceSlug);
  const [kind, setKind] = useState<"" | "CANVAS" | "DOCUMENT" | "PROJECT">("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 200);
  const templates = useTemplates({ kind: kind || undefined, category: category || undefined, q: dq || undefined });
  const [selected, setSelected] = useState<TemplateDto | null>(null);
  const targetWs = workspace ?? me?.workspaces.find((w) => w.slug === lastSlug) ?? me?.workspaces[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader title="Template gallery" description="Templates create real, editable content — tasks, documents, boards and canvas objects — not screenshots." />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentTabs value={kind} onChange={setKind} options={[{ value: "", label: "All" }, { value: "CANVAS", label: "Canvases" }, { value: "DOCUMENT", label: "Documents" }, { value: "PROJECT", label: "Projects" }]} />
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="w-56 pl-8" aria-label="Search templates" />
          </div>
          <SimpleSelect value={category || "all"} onChange={(v) => setCategory(v === "all" ? "" : v)} options={[{ value: "all", label: "All categories" }, ...(templates.data?.categories ?? []).map((c) => ({ value: c, label: c }))]} className="w-44" />
        </div>
      </div>
      {templates.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : templates.data?.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.items.map((t) => {
            const Icon = KIND_ICON[t.kind];
            return (
              <Card key={t.key} className="flex flex-col p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg text-lg" style={{ background: t.color ? `${t.color}22` : "var(--primary-soft)", color: t.color ?? "var(--primary)" }}>
                    {t.icon ?? <Icon className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{t.name}</h2>
                    <p className="text-xs text-text-muted">
                      {t.category} · {t.kind.toLowerCase()}
                    </p>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-sm text-text-secondary">{t.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {t.kind === "CANVAS" && t.objectCount ? <Badge variant="secondary">{t.objectCount} objects</Badge> : null}
                  {t.kind === "PROJECT" ? (
                    <>
                      <Badge variant="secondary">{t.taskCount} tasks</Badge>
                      <Badge variant="secondary">{t.documentCount} docs</Badge>
                      <Badge variant="secondary">{t.canvasCount} canvases</Badge>
                    </>
                  ) : null}
                  {t.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button className="mt-4" variant="subtle" onClick={() => setSelected(t)} disabled={isGuest || !targetWs}>
                  Use template
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<LayoutTemplate />} title="No templates match" description="Try a different search or category." />
      )}
      {selected && targetWs ? <UseTemplateDialog template={selected} workspaceId={targetWs.id} workspaceSlug={targetWs.slug} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function UseTemplateDialog({ template, workspaceId, workspaceSlug, onClose }: { template: TemplateDto; workspaceId: string; workspaceSlug: string; onClose: () => void }) {
  const router = useRouter();
  const projects = useProjects(workspaceId);
  const [title, setTitle] = useState(template.name);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      const res = await post<{ kind: string; id: string; title: string; boardId?: string }>(`/templates/${template.key}/instantiate`, { workspaceId, projectId: projectId || null, title: title.trim() || undefined });
      toast.success(`Created “${res.title}”`);
      onClose();
      router.push(res.kind === "CANVAS" ? `/app/${workspaceSlug}/canvas/${res.id}` : res.kind === "DOCUMENT" ? `/app/${workspaceSlug}/docs/${res.id}` : `/app/${workspaceSlug}/projects/${res.id}`);
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
          <DialogTitle>Use “{template.name}”</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={template.kind === "PROJECT" ? "Project name" : "Title"} htmlFor="tpl-title">
            <Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          {template.kind !== "PROJECT" ? (
            <Field label="Project (optional)">
              <SimpleSelect value={projectId || "none"} onChange={(v) => setProjectId(v === "none" ? "" : v)} options={[{ value: "none", label: "No project" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
