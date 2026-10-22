"use client";

import { useEffect, useRef } from "react";

export interface ShortcutOptions {
  /** Fire even when focus is in an input/textarea/contenteditable */
  allowInInputs?: boolean;
  enabled?: boolean;
  preventDefault?: boolean;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || Boolean(el.closest?.("[contenteditable=true]"));
}

/**
 * Register a keyboard shortcut. `combo` examples: "mod+k", "shift+?", "n", "mod+shift+z", "escape", "delete".
 * "mod" maps to ⌘ on macOS and Ctrl elsewhere.
 */
export function useShortcut(combo: string | string[], handler: (e: KeyboardEvent) => void, opts: ShortcutOptions = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  const combos = Array.isArray(combo) ? combo : [combo];
  const key = combos.join("|");
  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (!opts.allowInInputs && isTypingTarget(e.target)) return;
      for (const c of combos) {
        if (matches(e, c)) {
          if (opts.preventDefault !== false) e.preventDefault();
          ref.current(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.enabled, opts.allowInInputs, opts.preventDefault]);
}

export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const keyPart = parts.filter((p) => !["mod", "shift", "alt", "ctrl", "meta"].includes(p))[0] ?? "";
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (wantMod !== mod) return false;
  if (parts.includes("ctrl") && !e.ctrlKey) return false;
  if (wantShift !== e.shiftKey && keyPart !== "?") return false;
  if (wantAlt !== e.altKey) return false;
  const k = e.key.toLowerCase();
  if (keyPart === "escape") return k === "escape";
  if (keyPart === "delete") return k === "delete" || k === "backspace";
  if (keyPart === "space") return k === " ";
  if (keyPart === "?") return k === "?";
  if (keyPart === "enter") return k === "enter";
  if (keyPart.startsWith("arrow")) return k === keyPart;
  return k === keyPart;
}

export const SHORTCUTS: Array<{ group: string; items: Array<{ keys: string; label: string }> }> = [
  {
    group: "General",
    items: [
      { keys: "mod+K", label: "Command palette" },
      { keys: "?", label: "Keyboard shortcuts" },
      { keys: "G then H", label: "Go to home" },
      { keys: "G then I", label: "Go to inbox" },
      { keys: "mod+/", label: "Toggle sidebar" },
      { keys: "mod+J", label: "Toggle AI assistant" },
    ],
  },
  {
    group: "Canvas",
    items: [
      { keys: "V", label: "Select tool" },
      { keys: "H / Space", label: "Hand (pan)" },
      { keys: "N", label: "Sticky note" },
      { keys: "T", label: "Text" },
      { keys: "R / O / D", label: "Rectangle / Ellipse / Diamond" },
      { keys: "L / A", label: "Line / Arrow connector" },
      { keys: "P", label: "Freehand pen" },
      { keys: "F", label: "Frame" },
      { keys: "C", label: "Comment pin" },
      { keys: "mod+Z / mod+shift+Z", label: "Undo / Redo" },
      { keys: "mod+D", label: "Duplicate" },
      { keys: "mod+G / mod+shift+G", label: "Group / Ungroup" },
      { keys: "mod+A", label: "Select all" },
      { keys: "Delete", label: "Delete selection" },
      { keys: "shift+1", label: "Zoom to fit" },
      { keys: "shift+2", label: "Zoom to selection" },
      { keys: "mod+0", label: "Reset zoom" },
      { keys: "[ / ]", label: "Send backward / Bring forward" },
      { keys: "mod+L", label: "Lock / unlock" },
    ],
  },
  {
    group: "Documents",
    items: [
      { keys: "/", label: "Slash commands" },
      { keys: "mod+B / I / U", label: "Bold / Italic / Underline" },
      { keys: "mod+shift+M", label: "Add comment" },
      { keys: "mod+shift+F", label: "Focus mode" },
    ],
  },
  {
    group: "Tasks",
    items: [
      { keys: "C", label: "New task" },
      { keys: "Escape", label: "Close task panel" },
    ],
  },
];
