import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Inline comment anchor. The mark carries the thread id so the sidebar can highlight the
 * commented text; the thread itself lives in the database (never in Yjs).
 */
export interface CommentMarkOptions {
  onClick?: (threadId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (threadId: string) => ReturnType;
      unsetCommentMark: (threadId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: "commentMark",
  inclusive: false,
  excludes: "",
  addOptions() {
    return { onClick: undefined };
  },
  addAttributes() {
    return {
      threadId: { default: null, parseHTML: (el) => el.getAttribute("data-thread-id"), renderHTML: (attrs) => ({ "data-thread-id": attrs.threadId }) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-thread-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0];
  },
  addCommands() {
    return {
      setCommentMark:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      unsetCommentMark:
        (threadId) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          doc.descendants((node, pos) => {
            node.marks.forEach((m) => {
              if (m.type.name === this.name && m.attrs.threadId === threadId) tr.removeMark(pos, pos + node.nodeSize, m);
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
