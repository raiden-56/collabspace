"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { ReactNode } from "react";

export interface HeaderState {
  title: string | null;
  breadcrumbs: Array<{ label: string; href?: string }>;
  resource: { type: "CANVAS" | "DOCUMENT" | "PROJECT" | "MEETING" | "BOARD" | "TASK"; id: string; access?: string } | null;
  status: ReactNode | null;
  actions: ReactNode | null;
  set: (s: Partial<Omit<HeaderState, "set" | "reset">>) => void;
  reset: () => void;
}

const initial = { title: null, breadcrumbs: [], resource: null, status: null, actions: null };

export const useHeaderStore = create<HeaderState>()((set) => ({
  ...initial,
  set: (s) => set(s),
  reset: () => set(initial),
}));

/** Pages call this to populate the top bar with contextual title / breadcrumbs / actions. */
export function useHeader(state: Partial<Omit<HeaderState, "set" | "reset">>, deps: unknown[] = []) {
  const set = useHeaderStore((s) => s.set);
  const reset = useHeaderStore((s) => s.reset);
  useEffect(() => {
    set(state);
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
