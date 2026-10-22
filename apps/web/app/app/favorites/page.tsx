"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { get } from "@/lib/api";
import { useHeader } from "@/lib/stores/header-store";
import { useToggleFavorite } from "@/lib/queries";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ResourceIcon, humanResourceType, resourceHref } from "@/components/shared/resource-link";

interface Fav {
  resourceType: string;
  resourceId: string;
  title: string;
  workspaceSlug: string;
  workspaceName: string;
}

export default function FavoritesPage() {
  useHeader({ title: "Favorites" });
  const favorites = useQuery<Fav[]>({ queryKey: ["favorites"], queryFn: () => get("/users/me/favorites") });
  const toggle = useToggleFavorite();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader title="Favorites" description="Resources you've starred across all workspaces." />
      {favorites.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : favorites.data?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {favorites.data.map((f) => (
            <li key={`${f.resourceType}:${f.resourceId}`} className="flex items-center gap-3 px-4 py-3">
              <ResourceIcon type={f.resourceType} className="size-5 text-text-secondary" />
              <Link href={resourceHref(f.workspaceSlug, f.resourceType, f.resourceId)} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium hover:text-primary">{f.title}</p>
                <p className="text-xs text-text-muted">
                  {humanResourceType(f.resourceType)} · {f.workspaceName}
                </p>
              </Link>
              <Button variant="ghost" size="icon-sm" aria-label="Remove from favorites" onClick={() => toggle.mutate({ resourceType: f.resourceType, resourceId: f.resourceId })}>
                <Star className="fill-warning text-warning" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Star />} title="No favorites yet" description="Use the star in the top bar of any canvas, document, project or meeting to pin it here." />
      )}
    </div>
  );
}
