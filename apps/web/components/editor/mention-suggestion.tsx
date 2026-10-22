"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { UserAvatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface MentionUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  color?: string;
}

interface ListProps {
  items: MentionUser[];
  command: (item: { id: string; label: string }) => void;
}
interface ListRef {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<ListRef, ListProps>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const it = items[index];
        if (it) command({ id: it.id, label: it.name });
        return true;
      }
      return false;
    },
  }));
  if (!items.length) return <div className="rounded-lg border border-border bg-surface p-2 text-xs text-text-muted shadow-md">No members found</div>;
  return (
    <div className="w-64 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-md" role="listbox">
      {items.map((u, i) => (
        <button key={u.id} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => command({ id: u.id, label: u.name })} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === index && "bg-surface-2")}>
          <UserAvatar user={u} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{u.name}</span>
            {u.email ? <span className="block truncate text-[11px] text-text-muted">{u.email}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
});

/** Build the Tiptap Mention `suggestion` config from a getter for the current member list. */
export function mentionSuggestion(getMembers: () => MentionUser[]): Partial<SuggestionOptions<MentionUser>> {
  return {
    char: "@",
    items: ({ query }) => {
      const q = query.toLowerCase();
      return getMembers()
        .filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
        .slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<ListRef, ListProps> | null = null;
      let popup: TippyInstance[] | null = null;
      return {
        onStart: (props: SuggestionProps<MentionUser>) => {
          component = new ReactRenderer(MentionList, { props: { items: props.items, command: props.command as ListProps["command"] }, editor: props.editor });
          if (!props.clientRect) return;
          popup = tippy("body", { getReferenceClientRect: props.clientRect as () => DOMRect, appendTo: () => document.body, content: component.element, showOnCreate: true, interactive: true, trigger: "manual", placement: "bottom-start" });
        },
        onUpdate: (props: SuggestionProps<MentionUser>) => {
          component?.updateProps({ items: props.items, command: props.command as ListProps["command"] });
          if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}
