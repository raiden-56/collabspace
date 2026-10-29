import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { WebsocketProvider } from "y-websocket";
import { canvas as canvasLib } from "@collabspace/shared";
import { tiptapJsonToYDoc } from "@collabspace/shared/editor";
import type { CollabConnection } from "../yjs";
import { guestCanvasSnapshot, guestDocumentContent } from "./mock-api";

/**
 * Guest-mode replacement for the Yjs sync connection: no WebSocket, no IndexedDB. The document is
 * seeded from the sample data and stays editable locally; edits are kept in memory for the rest of
 * the session (navigating away and back keeps them, a reload starts over).
 */

const saved = new Map<string, Uint8Array>();

function seed(type: "canvas" | "document", id: string, doc: Y.Doc) {
  if (type === "document") {
    const content = guestDocumentContent(id);
    if (content) Y.applyUpdate(doc, Y.encodeStateAsUpdate(tiptapJsonToYDoc(content)));
  } else {
    const snapshot = guestCanvasSnapshot(id);
    if (snapshot) canvasLib.applySnapshot(doc, snapshot, "seed");
  }
}

export function createGuestCollabConnection(type: "canvas" | "document", id: string, user?: { userId: string; name: string; color: string; avatarUrl?: string | null } | null): CollabConnection {
  const room = `${type}:${id}`;
  const doc = new Y.Doc({ gc: true });
  const previous = saved.get(room);
  if (previous) Y.applyUpdate(doc, previous);
  else seed(type, id, doc);

  const awareness = new Awareness(doc);
  if (user) awareness.setLocalStateField("user", { ...user });
  // Only the parts of WebsocketProvider the editors touch (awareness for cursors, event hooks).
  const provider = { awareness, doc, on: () => {}, off: () => {}, connect: () => {}, disconnect: () => {}, destroy: () => {} } as unknown as WebsocketProvider;

  return {
    doc,
    provider,
    awareness,
    persistence: null,
    destroy: () => {
      saved.set(room, Y.encodeStateAsUpdate(doc));
      awareness.setLocalState(null);
      awareness.destroy();
      doc.destroy();
    },
  };
}

/** Forget locally edited documents (called when the guest session ends). */
export function resetGuestCollab() {
  saved.clear();
}
