"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight, Share2, Sparkles, Star, Menu } from "lucide-react";
import { useHeaderStore } from "@/lib/stores/header-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { usePresence } from "@/lib/realtime";
import { useToggleFavorite } from "@/lib/queries";
import { useApp } from "./workspace-context";
import { ConnectionStatus } from "./connection-status";
import { NotificationsPopover } from "./notifications-popover";
import { UserMenu } from "./user-menu";
import { ShareDialog } from "./share-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/overlays";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const { title, breadcrumbs, resource, status, actions } = useHeaderStore();
  const { workspace, isGuest } = useApp();
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);
  const assistantOpen = useUiStore((s) => s.assistantOpen);
  const [shareOpen, setShareOpen] = useState(false);
  const presence = usePresence(resource ? `resource:${resource.type.toLowerCase()}:${resource.id}` : null);
  const fav = useToggleFavorite();
  useShortcut("mod+j", () => setAssistantOpen(!assistantOpen));

  const canShare = resource && (resource.access === "OWNER" || resource.access === "EDITOR") && ["CANVAS", "DOCUMENT", "PROJECT", "MEETING"].includes(resource.type);
  const favoritable = resource && ["CANVAS", "DOCUMENT", "PROJECT", "MEETING"].includes(resource.type);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
      {onMenu ? (
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onMenu} aria-label="Open navigation">
          <Menu />
        </Button>
      ) : null}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {breadcrumbs.map((b, i) => (
          <Fragment key={`${b.label}-${i}`}>
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-text-muted" /> : null}
            {b.href ? (
              <Link href={b.href} className="truncate text-text-secondary hover:text-text">
                {b.label}
              </Link>
            ) : (
              <span className="truncate text-text-secondary">{b.label}</span>
            )}
          </Fragment>
        ))}
        {title ? (
          <>
            {breadcrumbs.length ? <ChevronRight className="size-3.5 shrink-0 text-text-muted" /> : null}
            <h1 className="truncate font-semibold text-text">{title}</h1>
          </>
        ) : null}
        {status ? <div className="ml-2 hidden sm:block">{status}</div> : null}
      </nav>

      <div className="flex items-center gap-1">
        {presence.length ? (
          <Tooltip content={`${presence.length} ${presence.length === 1 ? "person" : "people"} here: ${presence.map((p) => p.name).join(", ")}`}>
            <div className="mr-1 hidden sm:block">
              <AvatarStack users={presence} size="sm" max={5} />
            </div>
          </Tooltip>
        ) : null}
        {actions}
        {favoritable && workspace ? (
          <Tooltip content="Favorite">
            <Button variant="ghost" size="icon-sm" aria-label="Toggle favorite" onClick={() => fav.mutate({ resourceType: resource!.type, resourceId: resource!.id })}>
              <Star className={cn(fav.data?.favorite && "fill-warning text-warning")} />
            </Button>
          </Tooltip>
        ) : null}
        {canShare && !isGuest ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setShareOpen(true)}>
              <Share2 /> Share
            </Button>
            {shareOpen ? <ShareDialog resourceType={resource!.type} resourceId={resource!.id} title={title ?? ""} onClose={() => setShareOpen(false)} /> : null}
          </>
        ) : null}
        {workspace ? (
          <Tooltip content="AI assistant" shortcut="⌘J">
            <Button variant={assistantOpen ? "subtle" : "ghost"} size="icon-sm" aria-label="AI assistant" aria-pressed={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}>
              <Sparkles />
            </Button>
          </Tooltip>
        ) : null}
        <ConnectionStatus />
        <NotificationsPopover />
        <ThemeToggle compact />
        <UserMenu />
      </div>
    </header>
  );
}
