"use client";

import { useState } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Bold, CheckSquare, Copy, Group, Italic, LayoutGrid, Lock, MessageSquare, Trash2, Ungroup, Unlock, ArrowDown, ArrowUp, X, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { STICKY_COLORS, type CanvasObject } from "@collabspace/shared/canvas";
import type { CanvasOps } from "./use-canvas-doc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect, Switch } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const SHAPE_FILLS = ["#FFFFFF", "#E3EAFF", "#EFE9FF", "#E9F7F1", "#FDF3E7", "#FDECEC", "#F0F2F8", "#1F2430"];
const STROKES = ["#5B8CFF", "#9B7BFF", "#31B887", "#F4B740", "#EF6464", "#2FB7D9", "#1F2430", "#A0A9BC"];
const EMOJIS = ["👍", "❤️", "🎉", "💡", "❓", "✅"];

export function PropertyPanel({ selected, ops, readOnly, onClose, onConvertToTask, onComment, userId, onOpenLink }: { selected: CanvasObject[]; ops: CanvasOps; readOnly: boolean; onClose: () => void; onConvertToTask: (obj: CanvasObject) => void; onComment: (obj: CanvasObject) => void; userId: string | null; onOpenLink: (obj: CanvasObject) => void }) {
  const one = selected.length === 1 ? selected[0]! : null;
  const ids = selected.map((o) => o.id);
  const allLocked = selected.every((o) => o.locked);
  const patchAll = (patch: Partial<CanvasObject>) => ops.updateMany(ids.map((id) => ({ id, patch })));
  const types = new Set(selected.map((o) => o.type));
  const hasText = selected.some((o) => ["sticky", "text", "rect", "ellipse", "diamond", "node"].includes(o.type));
  const hasShape = selected.some((o) => ["rect", "ellipse", "diamond", "node", "frame", "line", "freehand", "connector"].includes(o.type));
  const hasSticky = types.has("sticky");
  const [tag, setTag] = useState("");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{one ? typeLabel(one.type) : `${selected.length} objects`}</h2>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close panel">
          <X />
        </Button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-3 scrollbar-thin">
        {one && (one.type === "frame" || one.type === "sticky" || one.type === "text" || one.type === "rect" || one.type === "ellipse" || one.type === "diamond" || one.type === "node" || one.type === "connector" || one.type === "embed" || one.type === "image") ? (
          <Section title={one.type === "frame" ? "Title" : one.type === "connector" ? "Label" : one.type === "embed" ? "Link" : one.type === "image" ? "Alt text" : "Text"}>
            {one.type === "embed" ? (
              <div className="space-y-2">
                <Input value={one.embedTitle ?? ""} onChange={(e) => ops.update(one.id, { embedTitle: e.target.value })} placeholder="Title" disabled={readOnly} />
                <Input value={one.url ?? ""} onChange={(e) => ops.update(one.id, { url: e.target.value })} placeholder="https://" disabled={readOnly} />
                <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenLink(one)}>
                  Open link
                </Button>
              </div>
            ) : (
              <Input value={one.type === "frame" ? one.title : one.type === "connector" ? one.label : one.type === "image" ? one.alt : one.text} onChange={(e) => ops.update(one.id, one.type === "frame" ? { title: e.target.value } : one.type === "connector" ? { label: e.target.value } : one.type === "image" ? { alt: e.target.value } : { text: e.target.value })} disabled={readOnly} />
            )}
          </Section>
        ) : null}

        {hasSticky ? (
          <Section title="Note color">
            <Swatches colors={[...STICKY_COLORS]} value={one?.color} onPick={(c) => patchAll({ color: c })} disabled={readOnly} />
          </Section>
        ) : null}
        {hasShape && !hasSticky ? (
          <Section title="Fill">
            <Swatches colors={SHAPE_FILLS} value={one?.fill} onPick={(c) => patchAll({ fill: c })} disabled={readOnly} />
          </Section>
        ) : null}
        {hasShape ? (
          <Section title="Stroke">
            <Swatches colors={STROKES} value={one?.stroke} onPick={(c) => patchAll({ stroke: c })} disabled={readOnly} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-text-secondary">
                Width
                <Input type="number" min={0} max={20} value={one?.strokeWidth ?? 2} onChange={(e) => patchAll({ strokeWidth: Number(e.target.value) })} className="mt-1 h-8" disabled={readOnly} />
              </label>
              {types.has("rect") || types.has("frame") || types.has("image") ? (
                <label className="text-xs text-text-secondary">
                  Radius
                  <Input type="number" min={0} max={64} value={one?.cornerRadius ?? 8} onChange={(e) => patchAll({ cornerRadius: Number(e.target.value) })} className="mt-1 h-8" disabled={readOnly} />
                </label>
              ) : null}
              {types.has("connector") || types.has("line") || types.has("freehand") ? (
                <label className="text-xs text-text-secondary">
                  Style
                  <SimpleSelect value={one?.lineStyle ?? "solid"} onChange={(v) => patchAll({ lineStyle: v as CanvasObject["lineStyle"] })} options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} className="mt-1 h-8" disabled={readOnly} />
                </label>
              ) : null}
            </div>
            {types.has("connector") ? (
              <div className="mt-2 flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <Switch checked={one?.arrowStart ?? false} onCheckedChange={(v) => patchAll({ arrowStart: v })} disabled={readOnly} /> Start arrow
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={one?.arrowEnd ?? true} onCheckedChange={(v) => patchAll({ arrowEnd: v })} disabled={readOnly} /> End arrow
                </label>
              </div>
            ) : null}
            {types.has("node") ? (
              <label className="mt-2 block text-xs text-text-secondary">
                Node shape
                <SimpleSelect value={one?.nodeShape ?? "rounded"} onChange={(v) => patchAll({ nodeShape: v as CanvasObject["nodeShape"] })} options={["rounded", "rect", "ellipse", "diamond", "parallelogram", "cylinder"].map((s) => ({ value: s, label: s }))} className="mt-1 h-8" disabled={readOnly} />
              </label>
            ) : null}
          </Section>
        ) : null}

        {hasText ? (
          <Section title="Typography">
            <div className="flex items-center gap-1">
              <Input type="number" min={8} max={120} value={one?.fontSize ?? 16} onChange={(e) => patchAll({ fontSize: Number(e.target.value) })} className="h-8 w-20" disabled={readOnly} aria-label="Font size" />
              <IconToggle active={one?.fontWeight === "bold"} onClick={() => patchAll({ fontWeight: one?.fontWeight === "bold" ? "normal" : "bold" })} label="Bold" disabled={readOnly}>
                <Bold />
              </IconToggle>
              <IconToggle active={one?.fontStyle === "italic"} onClick={() => patchAll({ fontStyle: one?.fontStyle === "italic" ? "normal" : "italic" })} label="Italic" disabled={readOnly}>
                <Italic />
              </IconToggle>
              <span className="mx-1 h-5 w-px bg-border" />
              <IconToggle active={one?.textAlign === "left"} onClick={() => patchAll({ textAlign: "left" })} label="Align left" disabled={readOnly}>
                <AlignLeft />
              </IconToggle>
              <IconToggle active={one?.textAlign === "center"} onClick={() => patchAll({ textAlign: "center" })} label="Align center" disabled={readOnly}>
                <AlignCenter />
              </IconToggle>
              <IconToggle active={one?.textAlign === "right"} onClick={() => patchAll({ textAlign: "right" })} label="Align right" disabled={readOnly}>
                <AlignRight />
              </IconToggle>
            </div>
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-text-muted">Text color</p>
              <Swatches colors={["#1F2430", "#5B6478", "#5B8CFF", "#9B7BFF", "#31B887", "#E05252", "#FFFFFF"]} value={one?.textColor} onPick={(c) => patchAll({ textColor: c })} disabled={readOnly} />
            </div>
          </Section>
        ) : null}

        <Section title="Layout">
          <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
            <label>
              Opacity
              <input type="range" min={0.1} max={1} step={0.05} value={one?.opacity ?? 1} onChange={(e) => patchAll({ opacity: Number(e.target.value) })} className="mt-1 w-full accent-primary" disabled={readOnly} aria-label="Opacity" />
            </label>
            {one && one.type !== "connector" ? (
              <label>
                Rotation
                <Input type="number" value={Math.round(one.rotation)} onChange={(e) => ops.update(one.id, { rotation: Number(e.target.value) })} className="mt-1 h-8" disabled={readOnly} />
              </label>
            ) : null}
          </div>
          {one && one.type !== "connector" ? (
            <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] text-text-muted">
              <Num label="X" value={one.x} onChange={(v) => ops.update(one.id, { x: v })} disabled={readOnly} />
              <Num label="Y" value={one.y} onChange={(v) => ops.update(one.id, { y: v })} disabled={readOnly} />
              <Num label="W" value={one.width} onChange={(v) => ops.update(one.id, { width: Math.max(10, v) })} disabled={readOnly} />
              <Num label="H" value={one.height} onChange={(v) => ops.update(one.id, { height: Math.max(10, v) })} disabled={readOnly} />
            </div>
          ) : null}
          {!readOnly ? (
            <div className="mt-3 flex flex-wrap gap-1">
              <Tooltip content="Bring forward" shortcut="]">
                <Button size="icon-sm" variant="outline" onClick={() => ops.reorder(ids, "forward")} aria-label="Bring forward">
                  <ArrowUp />
                </Button>
              </Tooltip>
              <Tooltip content="Send backward" shortcut="[">
                <Button size="icon-sm" variant="outline" onClick={() => ops.reorder(ids, "backward")} aria-label="Send backward">
                  <ArrowDown />
                </Button>
              </Tooltip>
              <Tooltip content={allLocked ? "Unlock" : "Lock"} shortcut="⌘L">
                <Button size="icon-sm" variant="outline" onClick={() => ops.setLocked(ids, !allLocked)} aria-label={allLocked ? "Unlock" : "Lock"}>
                  {allLocked ? <Unlock /> : <Lock />}
                </Button>
              </Tooltip>
              <Tooltip content="Duplicate" shortcut="⌘D">
                <Button size="icon-sm" variant="outline" onClick={() => ops.duplicate(ids)} aria-label="Duplicate">
                  <Copy />
                </Button>
              </Tooltip>
              {selected.length > 1 ? (
                selected.every((o) => o.groupId && o.groupId === selected[0]!.groupId) ? (
                  <Tooltip content="Ungroup" shortcut="⌘⇧G">
                    <Button size="icon-sm" variant="outline" onClick={() => ops.ungroup(ids)} aria-label="Ungroup">
                      <Ungroup />
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Group" shortcut="⌘G">
                    <Button size="icon-sm" variant="outline" onClick={() => ops.group(ids)} aria-label="Group">
                      <Group />
                    </Button>
                  </Tooltip>
                )
              ) : null}
              <Tooltip content="Delete" shortcut="⌫">
                <Button size="icon-sm" variant="outline" className="text-error" onClick={() => ops.remove(ids)} aria-label="Delete">
                  <Trash2 />
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </Section>

        {selected.length > 1 && !readOnly ? (
          <Section title="Align & distribute">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["left", AlignStartVertical, "Align left"],
                  ["centerX", AlignCenterVertical, "Align center"],
                  ["right", AlignEndVertical, "Align right"],
                  ["top", AlignStartHorizontal, "Align top"],
                  ["centerY", AlignCenterHorizontal, "Align middle"],
                  ["bottom", AlignEndHorizontal, "Align bottom"],
                ] as const
              ).map(([mode, Icon, label]) => (
                <Tooltip key={mode} content={label}>
                  <Button size="icon-sm" variant="outline" onClick={() => ops.align(ids, mode)} aria-label={label}>
                    <Icon />
                  </Button>
                </Tooltip>
              ))}
              {selected.length > 2 ? (
                <>
                  <Tooltip content="Distribute horizontally">
                    <Button size="icon-sm" variant="outline" onClick={() => ops.distribute(ids, "x")} aria-label="Distribute horizontally">
                      <AlignHorizontalDistributeCenter />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Distribute vertically">
                    <Button size="icon-sm" variant="outline" onClick={() => ops.distribute(ids, "y")} aria-label="Distribute vertically">
                      <AlignVerticalDistributeCenter />
                    </Button>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip content="Auto-arrange in a grid">
                <Button size="icon-sm" variant="outline" onClick={() => ops.arrange(ids)} aria-label="Auto-arrange">
                  <LayoutGrid />
                </Button>
              </Tooltip>
            </div>
          </Section>
        ) : null}

        {one?.type === "sticky" ? (
          <>
            <Section title="Tags">
              <div className="flex flex-wrap gap-1">
                {one.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                    #{t}
                    {!readOnly ? (
                      <button onClick={() => ops.update(one.id, { tags: one.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              {!readOnly ? (
                <form
                  className="mt-2 flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const t = tag.trim().replace(/^#/, "");
                    if (t && !one.tags.includes(t)) ops.update(one.id, { tags: [...one.tags, t] });
                    setTag("");
                  }}
                >
                  <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag" className="h-8" />
                  <Button type="submit" size="sm" variant="outline">
                    Add
                  </Button>
                </form>
              ) : null}
            </Section>
            <Section title="Reactions">
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((e) => {
                  const users = one.reactions[e] ?? [];
                  const mine = userId ? users.includes(userId) : false;
                  return (
                    <button
                      key={e}
                      disabled={!userId}
                      onClick={() => {
                        if (!userId) return;
                        const next = { ...one.reactions, [e]: mine ? users.filter((u) => u !== userId) : [...users, userId] };
                        if (!next[e]!.length) delete next[e];
                        ops.update(one.id, { reactions: next });
                      }}
                      aria-pressed={mine}
                      className={cn("rounded-full border px-2 py-0.5 text-sm", mine ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2")}
                    >
                      {e} {users.length ? <span className="text-xs text-text-muted">{users.length}</span> : null}
                    </button>
                  );
                })}
              </div>
            </Section>
          </>
        ) : null}

        {one && !readOnly ? (
          <Section title="Actions">
            <div className="flex flex-col gap-1.5">
              {one.type === "sticky" || one.type === "text" || one.type === "node" ? (
                one.taskId ? (
                  <Button size="sm" variant="subtle" onClick={() => onOpenLink(one)}>
                    <CheckSquare /> Open linked task
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onConvertToTask(one)}>
                    <CheckSquare /> Convert to task
                  </Button>
                )
              ) : null}
              {(one.type === "task" || one.type === "document") && (one.taskId || one.documentId) ? (
                <Button size="sm" variant="outline" onClick={() => onOpenLink(one)}>
                  Open {one.type}
                </Button>
              ) : null}
              {one.type !== "comment" && one.type !== "connector" ? (
                <Button size="sm" variant="outline" onClick={() => onComment(one)}>
                  <MessageSquare /> Comment on this
                </Button>
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Swatches({ colors, value, onPick, disabled }: { colors: string[]; value?: string; onPick: (c: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button key={c} disabled={disabled} onClick={() => onPick(c)} aria-label={`Color ${c}`} aria-pressed={value === c} className={cn("size-6 rounded-md border border-black/10 ring-offset-1 ring-offset-surface transition-transform hover:scale-110 disabled:opacity-50", value === c && "ring-2 ring-primary")} style={{ background: c }} />
      ))}
      <label className="relative size-6 cursor-pointer overflow-hidden rounded-md border border-border bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" aria-label="Custom color">
        <input type="color" disabled={disabled} className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

function IconToggle({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip content={label}>
      <button onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("flex size-8 items-center justify-center rounded-md border [&_svg]:size-4", active ? "border-primary bg-primary-soft text-primary" : "border-border text-text-secondary hover:bg-surface-2", disabled && "opacity-50")}>
        {children}
      </button>
    </Tooltip>
  );
}

function Num({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label>
      {label}
      <Input type="number" value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} className="mt-0.5 h-7 px-1.5 text-xs" disabled={disabled} />
    </label>
  );
}

export function typeLabel(t: CanvasObject["type"]): string {
  return { sticky: "Sticky note", text: "Text", rect: "Rectangle", ellipse: "Circle", diamond: "Diamond", line: "Line", connector: "Connector", freehand: "Drawing", image: "Image", file: "File", comment: "Comment", embed: "Embed", task: "Task card", document: "Document card", frame: "Section", node: "Diagram node" }[t];
}
