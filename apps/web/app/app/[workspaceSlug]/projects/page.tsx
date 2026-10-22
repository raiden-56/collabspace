"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, Search } from "lucide-react";
import { useProjects } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentTabs, Progress } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { AvatarStack } from "@/components/ui/avatar";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { formatDate, timeAgo } from "@/lib/utils";

const STATUS_BADGE: Record<string, "success" | "warning" | "secondary" | "default" | "violet"> = { ACTIVE: "success", PLANNING: "default", ON_HOLD: "warning", COMPLETED: "violet", ARCHIVED: "secondary" };

export default function ProjectsPage() {
  const { workspace, workspaceSlug, isGuest } = useApp();
  useHeader({ title: "Projects" });
  const dialogs = useCreateDialogs();
  const [filter, setFilter] = useState<"active" | "all" | "archived">("active");
  const [q, setQ] = useState("");
  const projects = useProjects(workspace?.id, filter !== "active");
  const list = (projects.data ?? []).filter((p) => (filter === "active" ? p.status !== "ARCHIVED" && p.status !== "COMPLETED" : filter === "archived" ? p.status === "ARCHIVED" || p.status === "COMPLETED" : true)).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.key.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Projects"
        description="Each project has its own board, tasks, documents, canvases and meetings."
        actions={
          !isGuest ? (
            <Button onClick={dialogs.openProject}>
              <Plus /> New project
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentTabs value={filter} onChange={setFilter} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Completed & archived" }, { value: "all", label: "All" }]} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects…" className="w-60 pl-8" aria-label="Filter projects" />
        </div>
      </div>
      {projects.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={q ? "No matching projects" : "No projects yet"} description="Projects group tasks, documents, canvases and meetings around a goal." action={!isGuest && !q ? <Button onClick={dialogs.openProject}><Plus /> Create a project</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const total = p.counts?.tasks ?? 0;
            const pct = total ? Math.round(((p.completedTasks ?? 0) / total) * 100) : 0;
            return (
              <Card key={p.id} className="flex flex-col p-5 transition-shadow hover:shadow-md">
                <Link href={`/app/${workspaceSlug}/projects/${p.id}`} className="flex items-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg text-base font-semibold" style={{ background: `${p.color}22`, color: p.color }}>
                    {p.icon ?? p.key.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold hover:text-primary">{p.name}</p>
                    <p className="text-xs text-text-muted">{p.key}</p>
                  </div>
                  <Badge variant={STATUS_BADGE[p.status] ?? "secondary"}>{p.status.toLowerCase().replace("_", " ")}</Badge>
                </Link>
                <p className="mt-3 line-clamp-2 flex-1 text-sm text-text-secondary">{p.description || "No description"}</p>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
                    <span>
                      {p.completedTasks ?? 0}/{total} tasks done
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} color={p.color} />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <AvatarStack users={(p.members ?? []).map((m) => m.user)} size="sm" />
                  <span className="text-[11px] text-text-muted">{p.dueDate ? `Due ${formatDate(p.dueDate)}` : `Updated ${timeAgo(p.updatedAt)}`}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
