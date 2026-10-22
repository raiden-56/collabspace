"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { CheckSquare, Code, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Quote, Table, Text, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashItem {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: "Text", description: "Plain paragraph", icon: Text, keywords: ["p", "paragraph"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { title: "Heading 1", description: "Large section heading", icon: Heading1, keywords: ["h1", "title"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run() },
  { title: "Heading 2", description: "Medium heading", icon: Heading2, keywords: ["h2"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() },
  { title: "Heading 3", description: "Small heading", icon: Heading3, keywords: ["h3"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() },
  { title: "Bulleted list", description: "Simple list", icon: List, keywords: ["ul", "bullet"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: "Numbered list", description: "Ordered list", icon: ListOrdered, keywords: ["ol", "numbered"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: "Checklist", description: "Track tasks with checkboxes", icon: CheckSquare, keywords: ["todo", "task", "check"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { title: "Quote", description: "Callout quote", icon: Quote, keywords: ["blockquote"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: "Code block", description: "Code with syntax highlighting", icon: Code, keywords: ["code", "pre"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: "Table", description: "3×3 table", icon: Table, keywords: ["grid"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Divider", description: "Horizontal rule", icon: Minus, keywords: ["hr", "rule", "line"], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { title: "Image", description: "Upload an image", icon: ImageIcon, keywords: ["img", "picture", "photo"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); window.dispatchEvent(new CustomEvent("collabspace:editor-upload")); } },
  { title: "Link", description: "Insert a link", icon: Link2, keywords: ["url", "href"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const url = window.prompt("Link URL"); if (url) editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run(); } },
];

interface ListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}
interface ListRef {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const SlashList = forwardRef<ListRef, ListProps>(function SlashList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        if (items[index]) command(items[index]!);
        return true;
      }
      return false;
    },
  }));
  if (!items.length) return <div className="rounded-lg border border-border bg-surface p-2 text-xs text-text-muted shadow-md">No matching blocks</div>;
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-md" role="listbox">
      {items.map((it, i) => (
        <button key={it.title} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => command(it)} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm", i === index && "bg-surface-2")}>
          <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-2 text-text-secondary">
            <it.icon className="size-4" />
          </span>
          <span>
            <span className="block font-medium">{it.title}</span>
            <span className="block text-xs text-text-muted">{it.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => props.command({ editor, range }),
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return SLASH_ITEMS.filter((it) => it.title.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))).slice(0, 10);
        },
        render: () => {
          let component: ReactRenderer<ListRef, ListProps> | null = null;
          let popup: TippyInstance[] | null = null;
          return {
            onStart: (props: SuggestionProps<SlashItem>) => {
              component = new ReactRenderer(SlashList, { props: { items: props.items, command: props.command }, editor: props.editor });
              if (!props.clientRect) return;
              popup = tippy("body", { getReferenceClientRect: props.clientRect as () => DOMRect, appendTo: () => document.body, content: component.element, showOnCreate: true, interactive: true, trigger: "manual", placement: "bottom-start" });
            },
            onUpdate: (props: SuggestionProps<SlashItem>) => {
              component?.updateProps({ items: props.items, command: props.command });
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
      } as Partial<SuggestionOptions<SlashItem>>,
    };
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
