"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Calendar, Check, CheckSquare, ChevronsUpDown, FileText, Files, FolderKanban, Home, Inbox, LayoutTemplate, MessageSquare, PanelLeftClose, PanelLeftOpen, PenTool, Plus, Search, Settings, Star, Users, Video, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/stores/ui-store";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useApp } from "./workspace-context";
import { useCreateDialogs } from "./create-dialogs";
import { useNotifications } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Tooltip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  exact?: boolean;
  create?: () => void;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, workspace, workspaceSlug, isGuest } = useApp();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const width = useUiStore((s) => s.sidebarWidth);
  const setWidth = useUiStore((s) => s.setSidebarWidth);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const dialogs = useCreateDialogs();
  const notifications = useNotifications();
  const unread = notifications.data?.unread ?? me?.unreadNotifications ?? 0;

  useShortcut("mod+/", () => setCollapsed(!collapsed));
  // "g then x" chords
  const chord = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) {
        chord.current = "g";
        setTimeout(() => (chord.current = null), 800);
        return;
      }
      if (chord.current === "g") {
        const base = workspaceSlug ? `/app/${workspaceSlug}` : "/app";
        const map: Record<string, string> = { h: "/app", i: "/app/inbox", p: `${base}/projects`, t: `${base}/tasks`, c: `${base}/calendar`, m: `${base}/meetings`, s: "/app/search" };
        const to = map[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          router.push(to);
        }
        chord.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, workspaceSlug]);

  const ws = workspaceSlug ? `/app/${workspaceSlug}` : null;
  const personal: NavItem[] = [
    { label: "Home", href: "/app", icon: Home, exact: true },
    { label: "Inbox", href: "/app/inbox", icon: Inbox, badge: unread },
    { label: "Favorites", href: "/app/favorites", icon: Star },
    { label: "Recent", href: "/app/recent", icon: Clock },
  ];
  const workspaceNav: NavItem[] = ws
    ? [
        { label: "Overview", href: ws, icon: Home, exact: true },
        { label: "Projects", href: `${ws}/projects`, icon: FolderKanban, create: isGuest ? undefined : dialogs.openProject },
        { label: "Canvases", href: `${ws}/canvases`, icon: PenTool, create: isGuest ? undefined : () => dialogs.openCanvas() },
        { label: "Documents", href: `${ws}/docs`, icon: FileText, create: isGuest ? undefined : () => dialogs.openDocument() },
        { label: "Tasks", href: `${ws}/tasks`, icon: CheckSquare, create: isGuest ? undefined : () => dialogs.openTask() },
        { label: "Calendar", href: `${ws}/calendar`, icon: Calendar },
        { label: "Meetings", href: `${ws}/meetings`, icon: Video },
        { label: "Team chat", href: `${ws}/chat`, icon: MessageSquare },
        { label: "Files", href: `${ws}/files`, icon: Files },
        { label: "Templates", href: `/app/templates`, icon: LayoutTemplate },
        { label: "Members", href: `${ws}/members`, icon: Users },
        { label: "Analytics", href: `${ws}/analytics`, icon: BarChart3 },
        { label: "Settings", href: `${ws}/settings`, icon: Settings },
      ]
    : [{ label: "Templates", href: "/app/templates", icon: LayoutTemplate }];

  // Resize handle
  const dragging = useRef(false);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setWidth(startW + (ev.clientX - startX));
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [width, setWidth],
  );

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));

  return (
    <aside
      className={cn("relative flex h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200", collapsed ? "w-[60px]" : "")}
      style={collapsed ? undefined : { width }}
      aria-label="Sidebar"
    >
      <div className={cn("flex h-14 items-center border-b border-border px-3", collapsed ? "justify-center" : "gap-2")}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <div className={cn("px-2 pt-2", collapsed && "px-1.5")}>
        <Tooltip content="Search (⌘K)" side="right">
          <button
            onClick={() => setCommandOpen(true)}
            className={cn("flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-muted hover:border-border-strong", collapsed && "justify-center px-0")}
            aria-label="Search"
          >
            <Search className="size-4 shrink-0" />
            {!collapsed ? (
              <>
                <span className="flex-1 text-left">Search…</span>
                <kbd className="kbd">⌘K</kbd>
              </>
            ) : null}
          </button>
        </Tooltip>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin" aria-label="Primary">
        <NavGroup items={personal} collapsed={collapsed} isActive={isActive} />
        {workspace ? (
          <>
            {!collapsed ? <p className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{workspace.name}</p> : <div className="my-3 h-px bg-border" />}
            <NavGroup items={workspaceNav} collapsed={collapsed} isActive={isActive} />
          </>
        ) : null}
      </nav>

      <div className={cn("flex items-center border-t border-border p-2", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && ws && !isGuest ? (
          <Button size="sm" variant="subtle" onClick={() => dialogs.openTask()}>
            <Plus /> New task
          </Button>
        ) : null}
        <Tooltip content={collapsed ? "Expand sidebar (⌘/)" : "Collapse sidebar (⌘/)"} side="right">
          <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </Tooltip>
      </div>
      {!collapsed ? <div role="separator" aria-orientation="vertical" onMouseDown={onMouseDown} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize hover:bg-primary/20" /> : null}
    </aside>
  );
}

function NavGroup({ items, collapsed, isActive }: { items: NavItem[]; collapsed: boolean; isActive: (i: NavItem) => boolean }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors",
              active ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
            {!collapsed && item.badge ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{item.badge > 99 ? "99+" : item.badge}</span> : null}
            {collapsed && item.badge ? <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" /> : null}
            {!collapsed && item.create ? (
              <span
                role="button"
                tabIndex={0}
                aria-label={`New ${item.label.toLowerCase()}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  item.create!();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    item.create!();
                  }
                }}
                className="hidden rounded p-0.5 text-text-muted hover:bg-surface-3 hover:text-text group-hover:block"
              >
                <Plus className="size-3.5" />
              </span>
            ) : null}
          </Link>
        );
        return (
          <li key={item.href + item.label} className="relative">
            {collapsed ? (
              <Tooltip content={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, workspace } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = workspace ?? me?.workspaces[0];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2", collapsed && "justify-center px-0")} aria-label="Switch workspace">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-secondary text-xs font-bold text-white">{(current?.name ?? "C").slice(0, 1).toUpperCase()}</span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{current?.name ?? "CollabSpace"}</span>
                {current ? <span className="block truncate text-[11px] text-text-muted">{current.role.toLowerCase()}</span> : null}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {me?.workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => router.push(`/app/${w.slug}`)}>
            <span className="flex size-6 items-center justify-center rounded bg-surface-3 text-[11px] font-bold">{w.name.slice(0, 1).toUpperCase()}</span>
            <span className="flex-1 truncate">{w.name}</span>
            {w.id === workspace?.id ? <Check className="text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/workspaces?new=1")}>
          <Plus /> Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/app/workspaces")}>
          <Settings /> Manage workspaces
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
