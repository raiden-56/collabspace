"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Home, Inbox, FileText, PenTool, CheckSquare, FolderKanban, UserPlus, Search, Moon, Sun, Monitor, Settings, Calendar, MessageSquare, Video, LayoutTemplate, Files, Users, BarChart3, Sparkles, Plus, Loader2 } from "lucide-react";
import { useUiStore } from "@/lib/stores/ui-store";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useApp } from "./workspace-context";
import { useCreateDialogs } from "./create-dialogs";
import { get, type SearchHit } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { modKey } from "@/lib/utils";

const TYPE_ICON: Record<string, React.ReactNode> = {
  DOCUMENT: <FileText />,
  CANVAS: <PenTool />,
  PROJECT: <FolderKanban />,
  TASK: <CheckSquare />,
  MEETING: <Video />,
  MESSAGE: <MessageSquare />,
  COMMENT: <MessageSquare />,
  FILE: <Files />,
};

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);
  const router = useRouter();
  const { workspace, workspaceSlug, canManage, isGuest } = useApp();
  const { setTheme } = useTheme();
  const dialogs = useCreateDialogs();
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 200);

  useShortcut("mod+k", () => setOpen(!open), { allowInInputs: true });
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const search = useQuery<{ hits: SearchHit[] }>({
    queryKey: ["cmd-search", workspace?.id, debounced],
    queryFn: () => get(`/search`, { workspaceId: workspace!.id, q: debounced, limit: 6 }),
    enabled: Boolean(workspace?.id && debounced.trim().length >= 2 && open),
    staleTime: 10_000,
  });

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const ws = workspaceSlug ? `/app/${workspaceSlug}` : null;
  const lower = q.toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(lower);

  const nav = useMemo(
    () =>
      [
        { label: "Home", icon: <Home />, href: "/app", keys: "G H" },
        { label: "Inbox", icon: <Inbox />, href: "/app/inbox", keys: "G I" },
        { label: "Search", icon: <Search />, href: ws ? `${ws}/../search` : "/app/search" },
        { label: "Templates", icon: <LayoutTemplate />, href: "/app/templates" },
        { label: "Personal settings", icon: <Settings />, href: "/app/settings" },
        ...(ws
          ? [
              { label: "Workspace overview", icon: <Home />, href: ws },
              { label: "Projects", icon: <FolderKanban />, href: `${ws}/projects` },
              { label: "Tasks", icon: <CheckSquare />, href: `${ws}/tasks` },
              { label: "Calendar", icon: <Calendar />, href: `${ws}/calendar` },
              { label: "Meetings", icon: <Video />, href: `${ws}/meetings` },
              { label: "Team chat", icon: <MessageSquare />, href: `${ws}/chat` },
              { label: "Files", icon: <Files />, href: `${ws}/files` },
              { label: "Members", icon: <Users />, href: `${ws}/members` },
              { label: "Analytics", icon: <BarChart3 />, href: `${ws}/analytics` },
              { label: "Workspace settings", icon: <Settings />, href: `${ws}/settings` },
            ]
          : []),
      ].filter((n) => match(n.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, q],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={workspace ? `Search ${workspace.name} or type a command…` : "Type a command…"} value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{search.isFetching ? "Searching…" : "No results."}</CommandEmpty>
        {search.data?.hits.length ? (
          <CommandGroup heading="Results">
            {search.data.hits.map((h) => (
              <CommandItem key={`${h.type}:${h.id}`} value={`${h.type}:${h.id}`} onSelect={() => go(h.href)}>
                {TYPE_ICON[h.type] ?? <FileText />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{h.title}</p>
                  {h.snippet ? <p className="truncate text-xs text-text-muted" dangerouslySetInnerHTML={{ __html: h.snippet.replace(/<mark>/g, '<mark class="rounded bg-warning/40 px-0.5">') }} /> : null}
                </div>
                <CommandShortcut>{h.type.toLowerCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {search.isFetching && !search.data ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
            <Loader2 className="size-3 animate-spin" /> Searching…
          </div>
        ) : null}
        {ws && !isGuest ? (
          <CommandGroup heading="Create">
            {match("New document") ? (
              <CommandItem value="new-document" onSelect={() => run(() => dialogs.openDocument())}>
                <FileText /> New document
              </CommandItem>
            ) : null}
            {match("New canvas") ? (
              <CommandItem value="new-canvas" onSelect={() => run(() => dialogs.openCanvas())}>
                <PenTool /> New canvas
              </CommandItem>
            ) : null}
            {match("New task") ? (
              <CommandItem value="new-task" onSelect={() => run(() => dialogs.openTask())}>
                <CheckSquare /> New task <CommandShortcut>C</CommandShortcut>
              </CommandItem>
            ) : null}
            {match("New project") ? (
              <CommandItem value="new-project" onSelect={() => run(() => dialogs.openProject())}>
                <FolderKanban /> New project
              </CommandItem>
            ) : null}
            {match("New meeting") ? (
              <CommandItem value="new-meeting" onSelect={() => go(`${ws}/meetings?new=1`)}>
                <Video /> New meeting
              </CommandItem>
            ) : null}
            {canManage && match("Invite a teammate") ? (
              <CommandItem value="invite" onSelect={() => run(() => dialogs.openInvite())}>
                <UserPlus /> Invite a teammate
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}
        {ws && match("Ask the AI assistant") ? (
          <CommandGroup heading="AI">
            <CommandItem value="assistant" onSelect={() => run(() => setAssistantOpen(true))}>
              <Sparkles /> Ask the AI assistant <CommandShortcut>{modKey} J</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {nav.length ? (
          <CommandGroup heading="Navigate">
            {nav.map((n) => (
              <CommandItem key={n.href + n.label} value={`nav-${n.label}`} onSelect={() => go(n.href)}>
                {n.icon} {n.label}
                {n.keys ? <CommandShortcut>{n.keys}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          {match("Light theme") ? (
            <CommandItem value="theme-light" onSelect={() => run(() => setTheme("light"))}>
              <Sun /> Light theme
            </CommandItem>
          ) : null}
          {match("Dark theme") ? (
            <CommandItem value="theme-dark" onSelect={() => run(() => setTheme("dark"))}>
              <Moon /> Dark theme
            </CommandItem>
          ) : null}
          {match("System theme") ? (
            <CommandItem value="theme-system" onSelect={() => run(() => setTheme("system"))}>
              <Monitor /> System theme
            </CommandItem>
          ) : null}
        </CommandGroup>
        {!ws && match("Create a workspace") ? (
          <CommandGroup heading="Workspaces">
            <CommandItem value="new-workspace" onSelect={() => go("/app/workspaces?new=1")}>
              <Plus /> Create a workspace
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
