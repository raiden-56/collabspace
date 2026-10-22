"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn, initials } from "@/lib/utils";

interface UserAvatarProps {
  user: { name: string; avatarUrl?: string | null; color?: string } | null | undefined;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  ring?: boolean;
  title?: string;
}

const sizes = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm", xl: "size-16 text-xl" };

export function UserAvatar({ user, size = "md", className, ring, title }: UserAvatarProps) {
  const name = user?.name ?? "?";
  const color = user?.color ?? "#5B8CFF";
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex shrink-0 overflow-hidden rounded-full font-semibold text-white select-none", sizes[size], ring && "ring-2 ring-surface", className)}
      style={{ background: color }}
      title={title ?? name}
    >
      {user?.avatarUrl ? <AvatarPrimitive.Image src={user.avatarUrl} alt={name} className="aspect-square size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center" delayMs={user?.avatarUrl ? 300 : 0}>
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function AvatarStack({ users, max = 4, size = "sm" }: { users: Array<{ id?: string; userId?: string; name: string; avatarUrl?: string | null; color?: string }>; max?: number; size?: UserAvatarProps["size"] }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((u, i) => (
        <UserAvatar key={u.id ?? u.userId ?? i} user={u} size={size} ring />
      ))}
      {extra > 0 ? <div className={cn("flex items-center justify-center rounded-full bg-surface-3 text-text-secondary ring-2 ring-surface font-medium", sizes[size])}>+{extra}</div> : null}
    </div>
  );
}
