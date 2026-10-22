"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckSquare, FileText, FolderKanban, PenTool, Plus, Video } from "lucide-react";
import { get, type ProjectDto, type TaskDto, type MeetingDto, type ActivityDto } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { activityLabel, resourceHref } from "@/components/shared/resource-link";
import { formatDate, timeAgo, cn } from "@/lib/utils";

interface Overview {
  projects: Array<ProjectDto & { taskCount: number }>;
  myTasks: Array<TaskDto & { overdue: boolean }>;
  upcomingMeetings: MeetingDto[];
  recentDocuments: Array<{ id: string; title: string; icon: string | null; updatedAt: string }>;
  recentCanvases: Array<{ id: string; title: string; updatedAt: string }>;
  activity: ActivityDto[];
}

export default function WorkspaceOverviewPage() {
  const { workspace, workspaceSlug, isGuest } = useApp();
  const dialogs = useCreateDialogs();
  useHeader({ title: workspace?.name ?? "Overview" }, [workspace?.name]);
  const overview = useQuery<Overview>({ queryKey: ["overview", workspace?.id], queryFn: () => get(`/workspaces/${workspace!.id}/overview`), enabled: Boolean(workspace) });
  const slug = workspaceSlug!;
  const d = overview.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={workspace?.name}
        description={workspace?.description ?? (workspace?.isDemo ? "This is a demo workspace with sample content marked [Demo]." : "Your team's connected workspace.")}
        actions={
          !isGuest ? (
            <>
              <Button variant="outline" onClick={() => dialogs.openCanvas()}>
                <PenTool /> New canvas
              </Button>
              <Button variant="outline" onClick={() => dialogs.openDocument()}>
                <FileText /> New document
              </Button>
              <Button onClick={dialogs.openProject}>
                <Plus /> New project
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FolderKanban className="size-4 text-primary" /> Projects
              </h2>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/app/${slug}/projects`}>
                  All projects <ArrowRight />
                </Link>
              </Button>
            </div>
            {overview.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
            ) : d?.projects.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {d.projects.map((p) => (
                  <Link key={p.id} href={`/app/${slug}/projects/${p.id}`} className="group rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg text-base" style={{ background: `${p.color}22`, color: p.color }}>
                        {p.icon ?? p.key.slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium group-hover:text-primary">{p.name}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-text-secondary">{p.description || `${p.taskCount} tasks`}</p>
                      </div>
                      <Badge variant={p.status === "ACTIVE" ? "success" : p.status === "ON_HOLD" ? "warning" : "secondary"}>{p.status.toLowerCase().replace("_", " ")}</Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                      <span>{p.taskCount} tasks</span>
                      {p.dueDate ? <span>Due {formatDate(p.dueDate)}</span> : null}
                      <span className="ml-auto">Updated {timeAgo(p.updatedAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Card className="p-8 text-center text-sm text-text-secondary">
                No projects yet.{" "}
                {!isGuest ? (
                  <button onClick={dialogs.openProject} className="text-primary underline">
                    Create the first one
                  </button>
                ) : null}
              </Card>
            )}
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="size-4 text-primary" /> Recent documents
                </h2>
                <Button asChild variant="ghost" size="xs">
                  <Link href={`/app/${slug}/docs`}>All</Link>
                </Button>
              </div>
              <ul className="space-y-0.5">
                {d?.recentDocuments.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/app/${slug}/docs/${doc.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="w-5 text-center">{doc.icon ?? "📄"}</span>
                      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                      <span className="text-[11px] text-text-muted">{formatDate(doc.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
                {d && d.recentDocuments.length === 0 ? <li className="px-2 py-4 text-center text-sm text-text-secondary">No documents yet.</li> : null}
              </ul>
            </Card>
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <PenTool className="size-4 text-primary" /> Recent canvases
                </h2>
                <Button asChild variant="ghost" size="xs">
                  <Link href={`/app/${slug}/canvases`}>All</Link>
                </Button>
              </div>
              <ul className="space-y-0.5">
                {d?.recentCanvases.map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/${slug}/canvas/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <PenTool className="size-4 text-text-muted" />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="text-[11px] text-text-muted">{formatDate(c.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
                {d && d.recentCanvases.length === 0 ? <li className="px-2 py-4 text-center text-sm text-text-secondary">No canvases yet.</li> : null}
              </ul>
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CheckSquare className="size-4 text-primary" /> My tasks
              </h2>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/app/${slug}/tasks?view=mine`}>All</Link>
              </Button>
            </div>
            {d?.myTasks.length ? (
              <ul className="space-y-0.5">
                {d.myTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/app/${slug}/tasks?task=${t.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="size-2 rounded-full" style={{ background: t.project.color }} />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.dueDate ? <span className={cn("text-[11px]", t.overdue ? "font-medium text-error" : "text-text-muted")}>{formatDate(t.dueDate)}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-center text-sm text-text-secondary">No open tasks assigned to you.</p>
            )}
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Video className="size-4 text-primary" /> Upcoming meetings
              </h2>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/app/${slug}/meetings`}>All</Link>
              </Button>
            </div>
            {d?.upcomingMeetings.length ? (
              <ul className="space-y-1">
                {d.upcomingMeetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/app/${slug}/meetings/${m.id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <p className="text-[11px] text-text-muted">
                        {formatDate(m.startsAt, true)} · {m.durationMin} min
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-center text-sm text-text-secondary">No upcoming meetings.</p>
            )}
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Activity</h2>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/app/${slug}/analytics?tab=activity`}>All</Link>
              </Button>
            </div>
            <ul className="space-y-3">
              {d?.activity.slice(0, 10).map((a) => (
                <li key={a.id} className="flex gap-2.5 text-xs">
                  <UserAvatar user={a.actor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-secondary">
                      <span className="font-medium text-text">{a.actor?.name ?? "Someone"}</span> {activityLabel(a.type, a.payload)}
                      {a.resourceType && a.resourceId && a.resourceTitle ? (
                        <>
                          {" "}
                          <Link href={resourceHref(slug, a.resourceType, a.resourceId)} className="font-medium text-text hover:underline">
                            {a.resourceTitle}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-text-muted">{timeAgo(a.createdAt)}</p>
                  </div>
                </li>
              ))}
              {d && d.activity.length === 0 ? <li className="py-4 text-center text-sm text-text-secondary">No activity yet.</li> : null}
            </ul>
          </Card>
          {d?.projects.length ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Project progress</h2>
              <ul className="space-y-3">
                {d.projects.slice(0, 5).map((p) => {
                  const pct = p.taskCount ? Math.round(((p.completedTasks ?? 0) / p.taskCount) * 100) : 0;
                  return (
                    <li key={p.id}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="text-text-muted">{pct}%</span>
                      </div>
                      <Progress value={pct} color={p.color} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
