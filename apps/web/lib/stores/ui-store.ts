"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  assistantOpen: boolean;
  lastWorkspaceSlug: string | null;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (v: number) => void;
  setRightPanelWidth: (v: number) => void;
  setCommandOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setAssistantOpen: (v: boolean) => void;
  setLastWorkspaceSlug: (v: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: 256,
      rightPanelWidth: 360,
      commandOpen: false,
      shortcutsOpen: false,
      assistantOpen: false,
      lastWorkspaceSlug: null,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setSidebarWidth: (v) => set({ sidebarWidth: Math.min(420, Math.max(200, v)) }),
      setRightPanelWidth: (v) => set({ rightPanelWidth: Math.min(640, Math.max(280, v)) }),
      setCommandOpen: (v) => set({ commandOpen: v }),
      setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
      setAssistantOpen: (v) => set({ assistantOpen: v }),
      setLastWorkspaceSlug: (v) => set({ lastWorkspaceSlug: v }),
    }),
    {
      name: "collabspace-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, sidebarWidth: s.sidebarWidth, rightPanelWidth: s.rightPanelWidth, lastWorkspaceSlug: s.lastWorkspaceSlug }),
    },
  ),
);
