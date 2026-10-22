"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { get, type Page } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

interface AuditLog {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; slug: string } | null;
}

export default function AuditLogsPage() {
  const [action, setAction] = useState("");
  const da = useDebounce(action, 250);
  const logs = useInfiniteQuery<Page<AuditLog>>({ queryKey: ["admin-audit", da], queryFn: ({ pageParam }) => get("/admin/audit-logs", { action: da || undefined, cursor: pageParam as string | undefined, limit: 50 }), initialPageParam: undefined as string | undefined, getNextPageParam: (l) => l.nextCursor ?? undefined });
  const list = logs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Audit logs" description="Security-relevant events: authentication, sharing, permission changes, AI usage and administrative actions. Content is never logged." actions={<Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action prefix, e.g. auth. or share." className="w-72" />} />
      {logs.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Actor</th>
                <th className="px-3 py-2 font-semibold">Workspace</th>
                <th className="px-3 py-2 font-semibold">Resource</th>
                <th className="px-3 py-2 font-semibold">IP</th>
                <th className="px-3 py-2 font-semibold">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatDate(l.createdAt, true)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={l.action.includes("failed") || l.action.includes("delete") ? "error" : l.action.startsWith("ai.") ? "violet" : "secondary"}>{l.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">{l.actor ? `${l.actor.name}` : "—"}</td>
                  <td className="px-3 py-2 text-xs">{l.workspace?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{l.resourceType ? `${l.resourceType.toLowerCase()} ${l.resourceId?.slice(-6) ?? ""}` : "—"}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{l.ip ?? "—"}</td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-[11px] text-text-muted" title={JSON.stringify(l.metadata)}>
                    {Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : ""}
                  </td>
                </tr>
              ))}
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-text-secondary">
                    No audit entries.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {logs.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => void logs.fetchNextPage()} loading={logs.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
