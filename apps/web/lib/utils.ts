import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict, format, isToday, isYesterday, isThisYear } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(date: string | Date): string {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

export function formatDate(date: string | Date | null | undefined, withTime = false): string {
  if (!date) return "";
  const d = new Date(date);
  if (withTime) {
    if (isToday(d)) return `Today, ${format(d, "p")}`;
    if (isYesterday(d)) return `Yesterday, ${format(d, "p")}`;
    return format(d, isThisYear(d) ? "MMM d, p" : "MMM d, yyyy, p");
  }
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, isThisYear(d) ? "MMM d" : "MMM d, yyyy");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";

export function statusLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  URGENT: { label: "Urgent", color: "var(--color-error)" },
  HIGH: { label: "High", color: "var(--color-warning)" },
  MEDIUM: { label: "Medium", color: "var(--color-primary)" },
  LOW: { label: "Low", color: "var(--color-success)" },
  NONE: { label: "No priority", color: "var(--color-text-secondary)" },
};
