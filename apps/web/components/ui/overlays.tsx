"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { X, Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Dialog ------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, size = "md", hideClose, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: "sm" | "md" | "lg" | "xl" | "full"; hideClose?: boolean }) {
  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-[96vw] h-[92vh]" };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-surface p-6 text-text shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 max-h-[92vh] overflow-y-auto",
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-8", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-text-secondary", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

/** Side sheet built on Dialog (used for task details, panels on small screens). */
export function SheetContent({ className, children, side = "right", ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "right" | "left" | "bottom" }) {
  const pos = {
    right: "inset-y-0 right-0 h-full w-full max-w-xl border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
    left: "inset-y-0 left-0 h-full w-full max-w-sm border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
    bottom: "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content className={cn("fixed z-50 flex flex-col bg-surface text-text shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out duration-200", pos[side], className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ---- Popover -------------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-72 rounded-lg border border-border bg-surface p-3 text-text shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ---- Tooltip --------------------------------------------------------------------

export function Tooltip({ content, children, side = "top", shortcut, delay }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; shortcut?: string; delay?: number }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[60] flex items-center gap-2 rounded-md bg-text px-2.5 py-1.5 text-xs font-medium text-bg shadow-md animate-in fade-in-0 zoom-in-95">
          {content}
          {shortcut ? <kbd className="rounded bg-white/15 px-1 font-mono text-[10px]">{shortcut}</kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---- Dropdown menu --------------------------------------------------------------

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

const menuContentClass = "z-50 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-surface p-1 text-text shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";
const menuItemClass = "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-secondary";

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>) {
  return (
    <DropdownPrimitive.SubTrigger className={cn(menuItemClass, "data-[state=open]:bg-surface-2", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </DropdownPrimitive.SubTrigger>
  );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent className={cn(menuContentClass, className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, shortcut, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean; shortcut?: string }) {
  return (
    <DropdownPrimitive.Item className={cn(menuItemClass, destructive && "text-error data-[highlighted]:bg-error-soft [&_svg]:text-error", className)} {...props}>
      {/* With `asChild` the Slot needs exactly one child, so don't add an empty shortcut sibling. */}
      {shortcut ? (
        <>
          {children}
          <span className="ml-auto pl-4 text-[11px] tracking-wide text-text-muted">{shortcut}</span>
        </>
      ) : (
        children
      )}
    </DropdownPrimitive.Item>
  );
}
export function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem className={cn(menuItemClass, "pl-8", className)} checked={checked} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}
export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>) {
  return (
    <DropdownPrimitive.RadioItem className={cn(menuItemClass, "pl-8", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

// ---- Context menu ----------------------------------------------------------------

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export function ContextMenuContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(menuContentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}
export function ContextMenuItem({ className, destructive, shortcut, children, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { destructive?: boolean; shortcut?: string }) {
  return (
    <ContextMenuPrimitive.Item className={cn(menuItemClass, destructive && "text-error data-[highlighted]:bg-error-soft [&_svg]:text-error", className)} {...props}>
      {children}
      {shortcut ? <span className="ml-auto pl-4 text-[11px] tracking-wide text-text-muted">{shortcut}</span> : null}
    </ContextMenuPrimitive.Item>
  );
}
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger className={cn(menuItemClass, "data-[state=open]:bg-surface-2", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent className={cn(menuContentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}
export function ContextMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
export function ContextMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label className={cn("px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted", className)} {...props} />;
}

// ---- Confirm dialog helper -----------------------------------------------------------

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, onConfirm, loading }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; confirmLabel?: string; destructive?: boolean; onConfirm: () => void | Promise<void>; loading?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className={cn("inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-white disabled:opacity-50", destructive ? "bg-error hover:brightness-110" : "bg-primary hover:bg-primary-hover")}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
