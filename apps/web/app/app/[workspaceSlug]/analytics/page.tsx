"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BarChart3, Info } from "lucide-react";
import { get, type ActivityDto, type Page, type UserRef } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { SegmentTabs, SimpleSelect, Progress } from "@/components/ui/controls";
import { Card, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/overlays";
import { activityLabel, resourceHref } from "@/components/shared/resource-link";
import { timeAgo, cn } from "@/lib/utils";

interface Analytics {
  definitions: Record<string, string>;
  totals: { tasks: number; completed: number; overdue: number; byStatus: Record<string, number> };
  completedOverTime: Array<{ date: string; count: number }>;
  workload: Array<{ user: UserRef; open: number; overdue: number; completed: number }>;
  projectProgress: Array<{ id: string; name: string; color: string; key: string; status: string; total: number; done: number; percent: number }>;
  actionItems: Array<{ status: string; count: number }>;
  collaboration: Array<{ type: string; count: number }>;
}

function AnalyticsContent() {
  const { workspace, workspaceSlug } = useApp();
  const params = useSearchParams();
  useHeader({ title: "Analytics" });
  const [tab, setTab] = useState<"metrics" | "activity">((params.get("tab") as "metrics") ?? "metrics");
  const analytics = useQuery<Analytics>({ queryKey: ["analytics", workspace?.id], queryFn: () => get(`/workspaces/${workspace!.id}/analytics`), enabled: Boolean(workspace) });
  const a = analytics.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader title="Analytics" description="Calculated from actual workspace records. No activity tracking of cursors, keystrokes or time online." />
      <SegmentTabs value={tab} onChange={setTab} options={[{ value: "metrics", label: "Metrics" }, { value: "activity", label: "Activity feed" }]} className="mb-6" />
      {tab === "activity" ? (
        <ActivityFeed />
      ) : analytics.isLoading || !a ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Total tasks" value={a.totals.tasks} />
            <Metric label="Completed" value={a.totals.completed} tone="success" />
            <Metric label="Overdue" value={a.totals.overdue} tone={a.totals.overdue ? "error" : undefined} definition={a.definitions.overdue} />
            <Metric label="Completion rate" value={a.totals.tasks ? `${Math.round((a.totals.completed / a.totals.tasks) * 100)}%` : "—"} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  Tasks completed over time
                  <Tooltip content={a.definitions.completedOverTime}>
                    <Info className="size-3.5 text-text-muted" />
                  </Tooltip>
                </h2>
                <span className="text-xs text-text-muted">Last 6 weeks</span>
              </div>
              <BarChart data={a.completedOverTime} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">Tasks by status</h2>
              <ul className="space-y-3">
                {Object.entries(a.totals.byStatus)
                  .sort((x, y) => y[1] - x[1])
                  .map(([status, count], i) => (
                    <li key={status}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize">{status.replace("_", " ")}</span>
                        <span className="text-text-muted">{count}</span>
                      </div>
                      <Progress value={(count / Math.max(1, a.totals.tasks)) * 100} color={["#5B8CFF", "#F4B740", "#9B7BFF", "#31B887", "#A0A9BC", "#2FB7D9"][i % 6]} />
                    </li>
                  ))}
                {Object.keys(a.totals.byStatus).length === 0 ? <li className="text-sm text-text-secondary">No tasks yet.</li> : null}
              </ul>
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                Workload by assignee
                <Tooltip content={a.definitions.workload}>
                  <Info className="size-3.5 text-text-muted" />
                </Tooltip>
              </h2>
              <p className="mb-4 text-xs text-text-secondary">Open, overdue and completed tasks per person.</p>
              <ul className="space-y-3">
                {a.workload
                  .filter((w) => w.open + w.completed > 0)
                  .sort((x, y) => y.open - x.open)
                  .map((w) => (
                    <li key={w.user.id} className="flex items-center gap-3">
                      <UserAvatar user={w.user} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="truncate font-medium">{w.user.name}</span>
                          <span className="text-xs text-text-muted">
                            {w.open} open{w.overdue ? <span className="text-error"> · {w.overdue} overdue</span> : null} · {w.completed} done
                          </span>
                        </div>
                        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface-3">
                          <div className="bg-success" style={{ width: `${(w.completed / Math.max(1, w.open + w.completed)) * 100}%` }} />
                          <div className="bg-error" style={{ width: `${(w.overdue / Math.max(1, w.open + w.completed)) * 100}%` }} />
                          <div className="bg-primary" style={{ width: `${((w.open - w.overdue) / Math.max(1, w.open + w.completed)) * 100}%` }} />
                        </div>
                      </div>
                    </li>
                  ))}
                {a.workload.every((w) => w.open + w.completed === 0) ? <li className="text-sm text-text-secondary">No assigned tasks yet.</li> : null}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">Project progress</h2>
              <ul className="space-y-3">
                {a.projectProgress.map((p) => (
                  <li key={p.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <Link href={`/app/${workspaceSlug}/projects/${p.id}`} className="truncate font-medium hover:text-primary">
                        {p.name}
                      </Link>
                      <span className="text-xs text-text-muted">
                        {p.done}/{p.total} · {p.percent}%
                      </span>
                    </div>
                    <Progress value={p.percent} color={p.color} />
                  </li>
                ))}
                {a.projectProgress.length === 0 ? <li className="text-sm text-text-secondary">No projects yet.</li> : null}
              </ul>
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                Meeting action items
                <Tooltip content={a.definitions.actionItems}>
                  <Info className="size-3.5 text-text-muted" />
                </Tooltip>
              </h2>
              <p className="mb-4 text-xs text-text-secondary">Drafts awaiting review versus items converted into tasks.</p>
              <div className="grid grid-cols-4 gap-2">
                {["DRAFT", "APPROVED", "CONVERTED", "REJECTED"].map((s) => (
                  <div key={s} className="rounded-lg bg-surface-2 p-3 text-center">
                    <p className="text-xl font-semibold">{a.actionItems.find((x) => x.status === s)?.count ?? 0}</p>
                    <p className="text-[11px] capitalize text-text-muted">{s.toLowerCase()}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold">Collaboration activity</h2>
              <p className="mb-4 text-xs text-text-secondary">Recorded events in the last 6 weeks, by type.</p>
              <ul className="space-y-2">
                {a.collaboration.map((c) => (
                  <li key={c.type} className="flex items-center gap-2 text-xs">
                    <span className="w-40 truncate text-text-secondary">{c.type.replace(/[._]/g, " ")}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-secondary" style={{ width: `${(c.count / Math.max(1, a.collaboration[0]?.count ?? 1)) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-text-muted">{c.count}</span>
                  </li>
                ))}
                {a.collaboration.length === 0 ? <li className="text-sm text-text-secondary">No activity recorded yet.</li> : null}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsContent />
    </Suspense>
  );
}

function Metric({ label, value, tone, definition }: { label: string; value: number | string; tone?: "success" | "error"; definition?: string }) {
  return (
    <Card className="p-5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
        {definition ? (
          <Tooltip content={definition}>
            <Info className="size-3" />
          </Tooltip>
        ) : null}
      </p>
      <p className={cn("mt-2 text-3xl font-semibold tracking-tight", tone === "success" && "text-success", tone === "error" && "text-error")}>{value}</p>
    </Card>
  );
}

function BarChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Completed tasks per day">
        {data.map((d) => (
          <Tooltip key={d.date} content={`${d.date}: ${d.count} completed`}>
            <div className="flex-1 rounded-t-sm bg-primary/80 transition-colors hover:bg-primary" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 4 : 1, opacity: d.count ? 1 : 0.25 }} />
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-text-muted">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[Math.floor(data.length / 2)]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { workspace, workspaceSlug } = useApp();
  const [type, setType] = useState("");
  const q = useInfiniteQuery<Page<ActivityDto>>({
    queryKey: ["activity", workspace?.id, type],
    queryFn: ({ pageParam }) => get(`/workspaces/${workspace!.id}/activity`, { cursor: pageParam as string | undefined, limit: 40, type: type || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(workspace),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-primary" /> Workspace activity
        </h2>
        <SimpleSelect value={type || "all"} onChange={(v) => setType(v === "all" ? "" : v)} options={[{ value: "all", label: "All events" }, { value: "task", label: "Tasks" }, { value: "document", label: "Documents" }, { value: "canvas", label: "Canvases" }, { value: "project", label: "Projects" }, { value: "meeting", label: "Meetings" }, { value: "member", label: "Members" }, { value: "share", label: "Sharing" }, { value: "comment", label: "Comments" }, { value: "file", label: "Files" }]} className="w-44" />
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.map((a) => (
          <li key={a.id} className="flex gap-3 px-4 py-3 text-sm">
            <UserAvatar user={a.actor} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-text-secondary">
                <span className="font-medium text-text">{a.actor?.name ?? "System"}</span> {activityLabel(a.type, a.payload)}
                {a.resourceType && a.resourceId && a.resourceTitle ? (
                  <>
                    {" "}
                    <Link href={resourceHref(workspaceSlug!, a.resourceType, a.resourceId)} className="font-medium text-text hover:underline">
                      {a.resourceTitle}
                    </Link>
                  </>
                ) : null}
              </p>
              <p className="text-xs text-text-muted">{timeAgo(a.createdAt)}</p>
            </div>
          </li>
        ))}
        {!q.isLoading && items.length === 0 ? <li className="px-4 py-8 text-center text-sm text-text-secondary">No activity recorded yet.</li> : null}
      </ul>
      {q.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
