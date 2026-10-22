"use client";

import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Inbox } from "lucide-react";
import { get, type NotificationDto, type Page } from "@/lib/api";
import { mutations } from "@/lib/queries";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { SegmentTabs } from "@/components/ui/controls";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { NotificationItem } from "@/components/app-shell/notifications-popover";

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "MENTION", label: "Mentions" },
  { value: "COMMENT,COMMENT_REPLY", label: "Comments" },
  { value: "TASK_ASSIGNED,TASK_DUE,TASK_STATUS", label: "Tasks" },
  { value: "MEETING_INVITE,MEETING_SUMMARY", label: "Meetings" },
  { value: "SHARE_ACCESS,WORKSPACE_INVITE,PROJECT_UPDATE", label: "Sharing" },
  { value: "AUTOMATION,SYSTEM", label: "Automation" },
];

export default function InboxPage() {
  useHeader({ title: "Inbox" });
  const [filter, setFilter] = useState("");
  const qc = useQueryClient();
  const query = useInfiniteQuery<Page<NotificationDto> & { unread: number }>({
    queryKey: ["notifications", "inbox", filter],
    queryFn: ({ pageParam }) => get(`/notifications`, { cursor: pageParam as string | undefined, limit: 30, unread: filter === "unread" ? true : undefined, type: filter && filter !== "unread" ? filter : undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = query.data?.pages[0]?.unread ?? 0;
  const grouped = groupByDay(items);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Inbox"
        description={unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "You're all caught up."}
        actions={
          unread ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await mutations.readAll();
                void qc.invalidateQueries({ queryKey: ["notifications"] });
              }}
            >
              <CheckCheck /> Mark all as read
            </Button>
          ) : null
        }
      />
      <SegmentTabs value={filter} onChange={setFilter} options={FILTERS} className="mb-4 overflow-x-auto no-scrollbar" />
      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox />} title="No notifications" description="Mentions, comments, assignments, meeting invites and shared resources will appear here." />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{day}</h2>
              <div className="rounded-xl border border-border bg-surface p-1">
                {list.map((n) => (
                  <NotificationItem key={n.id} n={n} />
                ))}
              </div>
            </section>
          ))}
          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function groupByDay(items: NotificationDto[]): Array<[string, NotificationDto[]]> {
  const map = new Map<string, NotificationDto[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400_000).toDateString();
  for (const n of items) {
    const d = new Date(n.createdAt).toDateString();
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(n.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric" });
    const list = map.get(label) ?? [];
    list.push(n);
    map.set(label, list);
  }
  return [...map.entries()];
}
