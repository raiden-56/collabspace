"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckSquare, Clock, Inbox, Plus, Star } from "lucide-react";
import { get, type TaskDto, type NotificationDto } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useNotifications } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { NotificationItem } from "@/components/app-shell/notifications-popover";
import { ResourceIcon, resourceHref } from "@/components/shared/resource-link";
import { formatDate, cn } from "@/lib/utils";

export default function HomePage() {
  const { me, user } = useApp();
  useHeader({ title: "Home" });
  const last = useUiStore((s) => s.lastWorkspaceSlug);
  const workspaces = me?.workspaces ?? [];
  const primary = workspaces.find((w) => w.slug === last) ?? workspaces[0];
  const notifications = useNotifications({ unread: true });
  const myTasks = useQuery<{ tasks: TaskDto[] }>({ queryKey: ["home-tasks", primary?.id], queryFn: () => get(`/workspaces/${primary!.id}/tasks`, { mine: true, limit: 8, sort: "dueDate" }), enabled: Boolean(primary) });
  const recent = useQuery<Array<{ resourceType: string; resourceId: string; title: string; workspaceSlug: string; openedAt: string }>>({ queryKey: ["recent"], queryFn: () => get("/users/me/recent") });
  const favorites = useQuery<Array<{ resourceType: string; resourceId: string; title: string; workspaceSlug: string }>>({ queryKey: ["favorites"], queryFn: () => get("/users/me/favorites") });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={`${greeting}, ${user?.name.split(" ")[0] ?? ""}`}
        description={formatDate(new Date(), false) === "Today" ? new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : undefined}
        actions={
          primary ? (
            <Button asChild>
              <Link href={`/app/${primary.slug}`}>
                Open {primary.name} <ArrowRight />
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/app/workspaces?new=1">
                <Plus /> Create workspace
              </Link>
            </Button>
          )
        }
      />

      {workspaces.length === 0 ? (
        <EmptyState title="You're not in a workspace yet" description="Create a workspace to start collaborating, or accept an invitation from your inbox." action={<Button asChild><Link href="/app/onboarding">Get started</Link></Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CheckSquare className="size-4 text-primary" /> My tasks {primary ? <span className="font-normal text-text-muted">in {primary.name}</span> : null}
                </h2>
                {primary ? (
                  <Button asChild variant="ghost" size="xs">
                    <Link href={`/app/${primary.slug}/tasks?view=mine`}>View all</Link>
                  </Button>
                ) : null}
              </div>
              {myTasks.isLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : myTasks.data?.tasks.length ? (
                <ul className="divide-y divide-border">
                  {myTasks.data.tasks.map((t) => {
                    const overdue = t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date();
                    return (
                      <li key={t.id}>
                        <Link href={`/app/${primary!.slug}/tasks?task=${t.id}`} className="flex items-center gap-3 py-2 hover:bg-surface-2 -mx-2 px-2 rounded-md">
                          <span className={cn("size-2 rounded-full", t.completedAt ? "bg-success" : "bg-primary")} />
                          <span className="font-mono text-[11px] text-text-muted">{t.key}</span>
                          <span className={cn("flex-1 truncate text-sm", t.completedAt && "text-text-muted line-through")}>{t.title}</span>
                          {t.dueDate ? <span className={cn("text-xs", overdue ? "text-error" : "text-text-muted")}>{formatDate(t.dueDate)}</span> : null}
                          <Badge variant="secondary">{t.status.replace("_", " ")}</Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-text-secondary">Nothing assigned to you right now.</p>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-primary" /> Recently opened
              </h2>
              {recent.data?.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {recent.data.slice(0, 8).map((r) => (
                    <li key={`${r.resourceType}:${r.resourceId}`}>
                      <Link href={resourceHref(r.workspaceSlug, r.resourceType, r.resourceId)} className="flex items-center gap-2.5 rounded-md border border-border p-2.5 hover:bg-surface-2">
                        <ResourceIcon type={r.resourceType} className="size-4 text-text-secondary" />
                        <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                        <span className="text-[11px] text-text-muted">{formatDate(r.openedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-text-secondary">Resources you open will show up here.</p>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Inbox className="size-4 text-primary" /> Inbox
                </h2>
                <Button asChild variant="ghost" size="xs">
                  <Link href="/app/inbox">Open</Link>
                </Button>
              </div>
              {notifications.data?.items.length ? (
                <div className="-mx-2 space-y-0.5">{notifications.data.items.slice(0, 5).map((n: NotificationDto) => <NotificationItem key={n.id} n={n} compact />)}</div>
              ) : (
                <p className="py-4 text-center text-sm text-text-secondary">All caught up.</p>
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Star className="size-4 text-warning" /> Favorites
                </h2>
                <Button asChild variant="ghost" size="xs">
                  <Link href="/app/favorites">All</Link>
                </Button>
              </div>
              {favorites.data?.length ? (
                <ul className="space-y-1">
                  {favorites.data.slice(0, 6).map((f) => (
                    <li key={`${f.resourceType}:${f.resourceId}`}>
                      <Link href={resourceHref(f.workspaceSlug, f.resourceType, f.resourceId)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                        <ResourceIcon type={f.resourceType} className="size-4 text-text-secondary" /> <span className="truncate">{f.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-text-secondary">Star canvases, docs and projects to pin them here.</p>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Your workspaces</h2>
              <ul className="space-y-1">
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <Link href={`/app/${w.slug}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-secondary text-xs font-bold text-white">{w.name.slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{w.name}</span>
                        <span className="block text-[11px] text-text-muted">
                          {w.memberCount} members · {w.projectCount} projects
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
