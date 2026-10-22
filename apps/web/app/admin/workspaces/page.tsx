"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Trash2, RotateCcw } from "lucide-react";
import { get, patch, errorMessage, type Page } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  deletedAt: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string };
  _count: { members: number; projects: number; documents: number; canvases: number };
}

export default function AdminWorkspacesPage() {
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 250);
  const qc = useQueryClient();
  const data = useInfiniteQuery<Page<AdminWorkspace>>({ queryKey: ["admin-workspaces", dq], queryFn: ({ pageParam }) => get("/admin/workspaces", { q: dq || undefined, cursor: pageParam as string | undefined, limit: 30 }), initialPageParam: undefined as string | undefined, getNextPageParam: (l) => l.nextCursor ?? undefined });
  const toggle = useMutation({ mutationFn: ({ id, deleted }: { id: string; deleted: boolean }) => patch(`/admin/workspaces/${id}`, { deleted }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-workspaces"] }); toast.success("Workspace updated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const list = data.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Workspaces" description="Every workspace on this deployment, including soft-deleted ones." actions={<div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or slug" className="w-64 pl-8" /></div>} />
      {data.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-sm font-bold text-white">{w.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {w.name} {w.isDemo ? <Badge variant="warning">demo</Badge> : null} {w.deletedAt ? <Badge variant="error">deleted</Badge> : null}
                </p>
                <p className="truncate text-xs text-text-muted">
                  /{w.slug} · owner {w.owner.name} ({w.owner.email}) · {w._count.members} members · {w._count.projects} projects · {w._count.documents} docs · {w._count.canvases} canvases · created {formatDate(w.createdAt)}
                </p>
              </div>
              {!w.deletedAt ? (
                <Button asChild size="xs" variant="outline">
                  <Link href={`/app/${w.slug}`}>Open</Link>
                </Button>
              ) : null}
              <Button size="xs" variant={w.deletedAt ? "subtle" : "ghost"} onClick={() => toggle.mutate({ id: w.id, deleted: !w.deletedAt })}>
                {w.deletedAt ? <RotateCcw /> : <Trash2 />} {w.deletedAt ? "Restore" : "Delete"}
              </Button>
            </li>
          ))}
          {list.length === 0 ? <li className="px-4 py-8 text-center text-sm text-text-secondary">No workspaces match.</li> : null}
        </ul>
      )}
      {data.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => void data.fetchNextPage()} loading={data.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
