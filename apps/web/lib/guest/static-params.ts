import { GUEST_BOARD_IDS, GUEST_CANVAS_IDS, GUEST_DOCUMENT_IDS, GUEST_MEETING_IDS, GUEST_PROJECT_IDS, GUEST_SPARE_IDS, GUEST_WORKSPACE_SLUG } from "./ids";

/**
 * `generateStaticParams` for the workspace routes.
 *
 * Only the static export (GitHub Pages, built with BASE_PATH set — same switch as next.config.ts)
 * needs them: it lists the guest workspace and its sample resources so those pages exist in `out/`.
 * In a normal server build the export is `undefined`, i.e. the routes stay fully dynamic exactly as
 * before and any real workspace slug / resource ID renders on demand.
 *
 * `dynamicParams` is deliberately not exported: route segment config must be a literal, so it can't
 * be switched per build, and `false` would 404 every real workspace in server mode. A static export
 * serves only the generated params anyway (Next only rejects an explicit `dynamicParams = true`).
 */
const IS_STATIC_EXPORT = process.env.BASE_PATH !== undefined;

type Params<K extends string> = Array<Record<K, string>>;

function staticParams<K extends string>(key: K, ids: readonly string[]): (() => Params<K>) | undefined {
  return IS_STATIC_EXPORT ? () => ids.map((id) => ({ [key]: id }) as Record<K, string>) : undefined;
}

export const workspaceStaticParams = staticParams("workspaceSlug", [GUEST_WORKSPACE_SLUG]);
export const projectStaticParams = staticParams("projectId", [...Object.values(GUEST_PROJECT_IDS), ...GUEST_SPARE_IDS.project]);
export const boardStaticParams = staticParams("boardId", [...Object.values(GUEST_BOARD_IDS), ...GUEST_SPARE_IDS.board]);
export const documentStaticParams = staticParams("documentId", [...Object.values(GUEST_DOCUMENT_IDS), ...GUEST_SPARE_IDS.document]);
export const canvasStaticParams = staticParams("canvasId", [...Object.values(GUEST_CANVAS_IDS), ...GUEST_SPARE_IDS.canvas]);
export const meetingStaticParams = staticParams("meetingId", [...Object.values(GUEST_MEETING_IDS), ...GUEST_SPARE_IDS.meeting]);
