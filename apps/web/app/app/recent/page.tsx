"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { get } from "@/lib/api";
import { useHeader } from "@/lib/stores/header-store";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { ResourceIcon, humanResourceType, resourceHref } from "@/components/shared/resource-link";
import { formatDate } from "@/lib/utils";

interface Recent {
  resourceType: string;
  resourceId: string;
  title: string;
  workspaceSlug: string;
  workspaceName: string;
  openedAt: string;
}

export default function RecentPage() {
  useHeader({ title: "Recent" });
  const recent = useQuery<Recent[]>({ queryKey: ["recent"], queryFn: () => get("/users/me/recent") });
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader title="Recently opened" description="Pick up where you left off." />
      {recent.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : recent.data?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {recent.data.map((r) => (
            <li key={`${r.resourceType}:${r.resourceId}`}>
              <Link href={resourceHref(r.workspaceSlug, r.resourceType, r.resourceId)} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <ResourceIcon type={r.resourceType} className="size-5 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-text-muted">
                    {humanResourceType(r.resourceType)} · {r.workspaceName}
                  </p>
                </div>
                <span className="text-xs text-text-muted">{formatDate(r.openedAt, true)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Clock />} title="Nothing opened yet" description="Canvases, documents, meetings and projects you open will appear here." />
      )}
    </div>
  );
}
