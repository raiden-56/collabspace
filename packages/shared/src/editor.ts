/**
 * Shared Tiptap/ProseMirror schema for collaborative documents.
 * The API uses it to seed documents from templates and to extract plain text for search/versions;
 * the web app layers Collaboration, CollaborationCaret, Placeholder and UI-only extensions on top.
 * Keep this list in sync on both sides so Yjs XML fragments always map to a known schema.
 */
import { getSchema, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Mention from "@tiptap/extension-mention";
import { createLowlight, common } from "lowlight";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import type { Node as PMNode } from "@tiptap/pm/model";

export const DOCUMENT_FRAGMENT = "default";

export const lowlight = createLowlight(common);

/** Extensions that define the document schema (no UI, no collaboration). */
export function baseDocumentExtensions(): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      // History is replaced by Yjs undo manager when Collaboration is active.
      undoRedo: false,
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: false }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Mention.configure({ HTMLAttributes: { class: "mention" } }),
  ];
}

export const documentSchema = getSchema(baseDocumentExtensions());

/** Build a Yjs document pre-filled with Tiptap JSON content. */
export function tiptapJsonToYDoc(json: Record<string, unknown>): Y.Doc {
  return prosemirrorJSONToYDoc(documentSchema, json, DOCUMENT_FRAGMENT);
}

/** Read Tiptap JSON back from a Yjs document. */
export function yDocToTiptapJson(doc: Y.Doc): Record<string, unknown> {
  return yDocToProsemirrorJSON(doc, DOCUMENT_FRAGMENT) as Record<string, unknown>;
}

/** Plain text (for search indexing, AI context, version previews). */
export function documentPlainText(doc: Y.Doc): string {
  try {
    const json = yDocToTiptapJson(doc);
    const node: PMNode = documentSchema.nodeFromJSON(json);
    return node.textBetween(0, node.content.size, "\n", (leaf) => (leaf.type.name === "mention" ? `@${leaf.attrs.label ?? ""}` : "")).trim();
  } catch {
    return "";
  }
}

/** Extract checklist items (for "convert checklist item into task"). */
export function extractChecklistItems(doc: Y.Doc): Array<{ text: string; checked: boolean }> {
  const out: Array<{ text: string; checked: boolean }> = [];
  try {
    const node = documentSchema.nodeFromJSON(yDocToTiptapJson(doc));
    node.descendants((n) => {
      if (n.type.name === "taskItem") {
        out.push({ text: n.textContent.trim(), checked: Boolean(n.attrs.checked) });
        return false;
      }
      return true;
    });
  } catch {
    /* ignore */
  }
  return out;
}

export const emptyDocumentJson = { type: "doc", content: [{ type: "paragraph" }] };
