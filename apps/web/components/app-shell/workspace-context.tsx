"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMe, useWorkspace } from "@/lib/queries";
import { realtime, useRealtime } from "@/lib/realtime";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@/lib/stores/ui-store";
import type { MeDto, WorkspaceDto, UserDto } from "@/lib/api";
import { toast } from "sonner";

interface AppContextValue {
  me: MeDto | undefined;
  user: UserDto | undefined;
  workspace: WorkspaceDto | undefined;
  workspaceSlug: string | undefined;
  isLoading: boolean;
  canManage: boolean;
  isGuest: boolean;
  refetchMe: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const params = useParams<{ workspaceSlug?: string }>();
  const slug = params?.workspaceSlug;
  const workspace = useWorkspace(slug);
  const qc = useQueryClient();
  const router = useRouter();
  const setLast = useUiStore((s) => s.setLastWorkspaceSlug);

  useEffect(() => {
    if (me.data) realtime.enable();
    return () => {
      /* keep the socket alive across route changes; disabled on logout */
    };
  }, [me.data]);

  useEffect(() => {
    if (slug && workspace.data) setLast(slug);
  }, [slug, workspace.data, setLast]);

  // Personal channel: notifications & cross-workspace events
  useRealtime(me.data ? `user:${me.data.user.id}` : null, (ev) => {
    if (ev.t === "notification:new") {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      const n = ev.p.notification as { title?: string; body?: string | null; href?: string | null; type?: string };
      if (n.type !== "CHAT_MESSAGE") {
        toast(n.title ?? "New notification", {
          description: n.body ?? undefined,
          action: n.href ? { label: "Open", onClick: () => router.push(n.href!) } : undefined,
        });
      }
    } else if (ev.t === "notification:read") {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    } else if (ev.t === "ai:job") {
      void qc.invalidateQueries({ queryKey: ["ai-jobs"] });
      if (ev.p.meetingId) void qc.invalidateQueries({ queryKey: ["meeting", ev.p.meetingId] });
    } else if (ev.t === "resource:updated" && ev.p.resourceType === "CHANNEL") {
      void qc.invalidateQueries({ queryKey: ["channels"] });
    }
  });

  // Workspace channel: resource/task updates → invalidate lists
  useRealtime(workspace.data ? `workspace:${workspace.data.id}` : null, (ev) => {
    if (ev.t === "task:updated") {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
      if (ev.p.taskId) void qc.invalidateQueries({ queryKey: ["task", ev.p.taskId] });
      void qc.invalidateQueries({ queryKey: ["project", ev.p.projectId] });
    } else if (ev.t === "resource:updated") {
      const t = ev.p.resourceType.toLowerCase();
      void qc.invalidateQueries({ queryKey: [t === "canvas" ? "canvases" : t === "document" ? "documents" : t === "project" ? "projects" : t === "meeting" ? "meetings" : t] });
      void qc.invalidateQueries({ queryKey: [t, ev.p.resourceId] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
    }
  });

  const value = useMemo<AppContextValue>(() => {
    const role = workspace.data?.role;
    return {
      me: me.data,
      user: me.data?.user,
      workspace: workspace.data,
      workspaceSlug: slug,
      isLoading: me.isLoading || (Boolean(slug) && workspace.isLoading),
      canManage: role === "OWNER" || role === "ADMIN" || me.data?.user.platformRole === "ADMIN",
      isGuest: role === "GUEST",
      refetchMe: () => void me.refetch(),
    };
  }, [me.data, me.isLoading, me.refetch, workspace.data, workspace.isLoading, slug]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Current workspace (throws if used outside a workspace route). */
export function useCurrentWorkspace() {
  const { workspace, workspaceSlug } = useApp();
  return { workspace, slug: workspaceSlug ?? workspace?.slug ?? "", wsId: workspace?.id };
}
