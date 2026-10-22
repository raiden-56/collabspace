export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";
}

export function projectKeyFromName(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PRJ";
  if (words.length === 1) return words[0]!.slice(0, 4).toUpperCase();
  return words.slice(0, 4).map((w) => w[0]!.toUpperCase()).join("");
}

export const USER_COLORS = [
  "#5B8CFF", "#9B7BFF", "#31B887", "#F4B740", "#EF6464", "#2FB7D9", "#E06AB5", "#7FB534",
] as const;

export function pickUserColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length]!;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
}

export function extractMentions(body: string): string[] {
  // Mentions are serialized as @[Name](userId)
  const ids = new Set<string>();
  for (const m of body.matchAll(/@\[[^\]]+\]\(([a-zA-Z0-9_-]+)\)/g)) ids.add(m[1]!);
  return [...ids];
}

export function collabKey(type: "canvas" | "document", id: string): string {
  return `${type}:${id}`;
}

export function parseCollabKey(key: string): { type: "canvas" | "document"; id: string } | null {
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  const type = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if ((type !== "canvas" && type !== "document") || !id) return null;
  return { type, id };
}
