/** Mentions are stored as @[Display Name](userId) in comment and chat bodies. */

export const MENTION_RE = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;

export interface MentionPart {
  type: "text" | "mention";
  text: string;
  userId?: string;
}

export function parseMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ type: "text", text: body.slice(last, idx) });
    parts.push({ type: "mention", text: `@${m[1]}`, userId: m[2] });
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", text: body.slice(last) });
  return parts;
}

export function mentionToken(user: { id: string; name: string }): string {
  return `@[${user.name}](${user.id})`;
}

export function stripMentions(body: string): string {
  return body.replace(MENTION_RE, "@$1");
}

/**
 * Detect an in-progress "@query" at the caret for autocomplete.
 * Single spaces are allowed so multi-word names can be matched; the query ends at brackets,
 * newlines, a double space, or 40 characters.
 */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\]()\n]/.test(query) || /\s{2,}/.test(query) || query.length > 40) return null;
  return { query, start: at };
}
