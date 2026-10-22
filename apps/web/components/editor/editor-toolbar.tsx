"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Bold, Code, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListOrdered, CheckSquare, Quote, Strikethrough, Table, Underline, AlignLeft, AlignCenter, AlignRight, Image as ImageIcon, Minus, Palette, MessageSquarePlus, Undo2, Redo2 } from "lucide-react";
import { Tooltip, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const TEXT_COLORS = ["#1F2430", "#5B8CFF", "#9B7BFF", "#31B887", "#F4B740", "#EF6464", "#2FB7D9", "#A0A9BC"];
const HIGHLIGHTS = ["#FFF3A3", "#C7E9FF", "#D9F7E8", "#F9D5E5", "#E8E0FF", "#FFE0C2"];

export function EditorToolbar({ editor, onComment, onImage, readOnly }: { editor: Editor; onComment?: () => void; onImage: () => void; readOnly: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => e === null || e.isDestroyed ? null : ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      hasSelection: !e.state.selection.empty,
      canUndo: typeof e.commands.undo === "function" ? e.can().undo() : false,
      canRedo: typeof e.commands.redo === "function" ? e.can().redo() : false,
    }),
  });
  if (readOnly) return null;
  const B = ({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) => (
    <Tooltip content={label}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("flex size-8 items-center justify-center rounded-md transition-colors [&_svg]:size-4", active ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text", disabled && "opacity-40")}>
        {children}
      </button>
    </Tooltip>
  );
  const Sep = () => <span className="mx-1 h-5 w-px bg-border" />;
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url) return editor.chain().focus().extendMarkRange("link").unsetLink().run();
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-border p-1 shadow-sm glass" role="toolbar" aria-label="Formatting">
      <B label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!state?.canUndo}><Undo2 /></B>
      <B label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!state?.canRedo}><Redo2 /></B>
      <Sep />
      <B label="Heading 1" active={state?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></B>
      <B label="Heading 2" active={state?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></B>
      <B label="Heading 3" active={state?.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></B>
      <Sep />
      <B label="Bold (⌘B)" active={state?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></B>
      <B label="Italic (⌘I)" active={state?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></B>
      <B label="Underline (⌘U)" active={state?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></B>
      <B label="Strikethrough" active={state?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></B>
      <B label="Inline code" active={state?.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></B>
      <Popover>
        <Tooltip content="Text color">
          <PopoverTrigger asChild>
            <button type="button" className="flex size-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 [&_svg]:size-4" aria-label="Text color"><Palette /></button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent className="w-auto p-2">
          <p className="mb-1 text-[11px] text-text-muted">Text</p>
          <div className="mb-2 flex gap-1">
            {TEXT_COLORS.map((c) => <button key={c} className="size-6 rounded-md border border-black/10" style={{ background: c }} aria-label={c} onClick={() => editor.chain().focus().setColor(c).run()} />)}
            <button className="rounded-md border border-border px-1.5 text-[10px]" onClick={() => editor.chain().focus().unsetColor().run()}>reset</button>
          </div>
          <p className="mb-1 text-[11px] text-text-muted">Highlight</p>
          <div className="flex gap-1">
            {HIGHLIGHTS.map((c) => <button key={c} className="size-6 rounded-md border border-black/10" style={{ background: c }} aria-label={c} onClick={() => editor.chain().focus().toggleHighlight({ color: c }).run()} />)}
            <button className="rounded-md border border-border px-1.5 text-[10px]" onClick={() => editor.chain().focus().unsetHighlight().run()}>none</button>
          </div>
        </PopoverContent>
      </Popover>
      <B label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter /></B>
      <Sep />
      <B label="Bulleted list" active={state?.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></B>
      <B label="Numbered list" active={state?.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></B>
      <B label="Checklist" active={state?.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></B>
      <B label="Quote" active={state?.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></B>
      <B label="Code block" active={state?.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code /></B>
      <Sep />
      <B label="Align left" active={state?.left} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft /></B>
      <B label="Align center" active={state?.center} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter /></B>
      <B label="Align right" active={state?.right} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight /></B>
      <Sep />
      <B label="Link (⌘K)" active={state?.link} onClick={setLink}><Link2 /></B>
      <B label="Image" onClick={onImage}><ImageIcon /></B>
      <B label="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></B>
      <B label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></B>
      {onComment ? (
        <>
          <Sep />
          <B label="Comment on selection (⌘⇧M)" onClick={onComment} disabled={!state?.hasSelection}><MessageSquarePlus /></B>
        </>
      ) : null}
    </div>
  );
}
