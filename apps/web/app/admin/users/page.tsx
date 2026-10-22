"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ShieldCheck, UserX, UserCheck } from "lucide-react";
import { get, patch, errorMessage, type Page, type UserDto } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { PageHeader, Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

type AdminUser = UserDto & { disabledAt: string | null; deletedAt: string | null; workspaces: number; activeSessions: number; createdAt: string };

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 250);
  const qc = useQueryClient();
  const users = useInfiniteQuery<Page<AdminUser>>({ queryKey: ["admin-users", dq], queryFn: ({ pageParam }) => get("/admin/users", { q: dq || undefined, cursor: pageParam as string | undefined, limit: 30 }), initialPageParam: undefined as string | undefined, getNextPageParam: (l) => l.nextCursor ?? undefined });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/admin/users/${id}`, body), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("User updated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const list = users.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Users" description="All accounts on this deployment." actions={<div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="w-64 pl-8" /></div>} />
      {users.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar user={u} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {u.name}
                  {u.platformRole === "ADMIN" ? <Badge variant="violet">admin</Badge> : null}
                  {u.disabledAt ? <Badge variant="error">disabled</Badge> : null}
                  {u.deletedAt ? <Badge variant="secondary">deleted</Badge> : null}
                  {!u.emailVerified ? <Badge variant="warning">unverified</Badge> : null}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {u.email} · {u.workspaces} workspaces · {u.activeSessions} sessions · joined {formatDate(u.createdAt)}
                </p>
              </div>
              {!u.deletedAt ? (
                <div className="flex gap-1">
                  <Button size="xs" variant="outline" onClick={() => update.mutate({ id: u.id, body: { platformRole: u.platformRole === "ADMIN" ? "USER" : "ADMIN" } })}>
                    <ShieldCheck /> {u.platformRole === "ADMIN" ? "Revoke admin" : "Make admin"}
                  </Button>
                  {!u.emailVerified ? (
                    <Button size="xs" variant="outline" onClick={() => update.mutate({ id: u.id, body: { emailVerified: true } })}>
                      Verify
                    </Button>
                  ) : null}
                  <Button size="xs" variant={u.disabledAt ? "subtle" : "ghost"} onClick={() => update.mutate({ id: u.id, body: { disabled: !u.disabledAt } })}>
                    {u.disabledAt ? <UserCheck /> : <UserX />} {u.disabledAt ? "Enable" : "Disable"}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
          {list.length === 0 ? <li className="px-4 py-8 text-center text-sm text-text-secondary">No users match.</li> : null}
        </ul>
      )}
      {users.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => void users.fetchNextPage()} loading={users.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
