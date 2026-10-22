"use client";

import { useUiStore } from "@/lib/stores/ui-store";
import { SHORTCUTS, useShortcut } from "@/lib/hooks/use-shortcut";
import { modKey } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/overlays";

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  useShortcut("shift+?", () => setOpen(!open));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work faster across the canvas, documents and tasks.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{g.group}</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-text-secondary">{it.label}</span>
                    <span className="flex gap-1">
                      {it.keys.split(" / ").map((k) => (
                        <kbd key={k} className="kbd !h-6 !px-1.5 !text-[11px]">
                          {k.replace("mod", modKey)}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
