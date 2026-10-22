import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="cs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#9B7BFF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#cs-g)" />
      <rect x="14" y="16" width="18" height="18" rx="4" fill="#fff" opacity=".95" />
      <rect x="32" y="30" width="18" height="18" rx="4" fill="#fff" opacity=".75" />
      <path d="M32 25h8a4 4 0 0 1 4 4v1" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ href = "/", className, compact }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight text-text", className)}>
      <LogoMark />
      {!compact ? <span className="text-[17px]">CollabSpace</span> : null}
    </Link>
  );
}
