import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDto, MeDto, MeetingDto, ProjectDto, TaskDto } from "../api";
import { GUEST_BOARD_IDS, GUEST_CANVAS_IDS, GUEST_DOCUMENT_IDS, GUEST_MEETING_IDS, GUEST_PROJECT_IDS, GUEST_SPARE_IDS, GUEST_WORKSPACE_ID, GUEST_WORKSPACE_SLUG } from "./ids";
import { handleGuestRequest, resetGuestData } from "./mock-api";

const get = <T,>(path: string, query: Record<string, string> = {}) => handleGuestRequest<T>({ method: "GET", path, query, body: undefined });
const send = <T,>(method: string, path: string, body: unknown = {}) => handleGuestRequest<T>({ method, path, query: {}, body });
const ws = `/workspaces/${GUEST_WORKSPACE_ID}`;

beforeEach(() => resetGuestData());

describe("guest mock API", () => {
  it("signs in as the demo user with the demo workspace", async () => {
    const me = await get<MeDto>("/auth/me");
    expect(me.user.name).toBe("Alice Rivera");
    expect(me.workspaces.map((w) => w.slug)).toEqual([GUEST_WORKSPACE_SLUG]);
    expect((await get<{ slug: string; role: string }>(`/workspaces/${GUEST_WORKSPACE_SLUG}`)).role).toBe("OWNER");
  });

  it.each([
    [`${ws}/projects`],
    [`${ws}/members`],
    [`${ws}/labels`],
    [`${ws}/canvases`],
    [`${ws}/documents`],
    [`${ws}/folders`],
    [`${ws}/meetings`],
    [`${ws}/channels`],
    [`${ws}/files`],
    [`${ws}/invitations`],
    ["/users/me/favorites"],
    ["/users/me/recent"],
    ["/auth/sessions"],
    [`/projects/${GUEST_PROJECT_IDS.launch}/milestones`],
    [`/canvases/${GUEST_CANVAS_IDS.brainstorm}/versions`],
    [`/documents/${GUEST_DOCUMENT_IDS.designDoc}/versions`],
  ])("returns sample data for %s", async (path) => {
    expect((await get<unknown[]>(path)).length).toBeGreaterThan(0);
  });

  it("serves the workspace dashboards", async () => {
    const overview = await get<{ projects: unknown[]; myTasks: unknown[]; upcomingMeetings: unknown[]; activity: unknown[] }>(`${ws}/overview`);
    expect(overview.projects.length && overview.myTasks.length && overview.upcomingMeetings.length && overview.activity.length).toBeTruthy();
    const analytics = await get<{ totals: { tasks: number; completed: number }; completedOverTime: unknown[] }>(`${ws}/analytics`);
    expect(analytics.totals.completed).toBeGreaterThan(0);
    expect(analytics.completedOverTime).toHaveLength(42);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const calendar = await get<Array<{ kind: string }>>(`${ws}/calendar`, { from, to, types: "task,meeting,milestone,event" });
    expect(new Set(calendar.map((c) => c.kind))).toEqual(new Set(["task", "meeting", "milestone", "event"]));
    expect((await get<{ items: unknown[] }>(`${ws}/activity`, { limit: "10" })).items).toHaveLength(10);
    expect((await get<{ items: unknown[]; unread: number }>("/notifications")).unread).toBeGreaterThan(0);
    expect((await get<{ items: unknown[] }>("/templates")).items.length).toBeGreaterThan(10);
    expect((await get<{ hits: unknown[] }>("/search", { workspaceId: GUEST_WORKSPACE_ID, q: "storage" })).hits.length).toBeGreaterThan(0);
  });

  it("serves project, board, meeting and chat detail", async () => {
    const project = await get<ProjectDto>(`/projects/${GUEST_PROJECT_IDS.launch}`);
    expect(project.dashboard?.totals.tasks).toBeGreaterThan(5);
    const board = await get<BoardDto>(`/boards/${GUEST_BOARD_IDS.launch}`);
    expect(board.columns).toHaveLength(5);
    expect(board.tasks.length).toBeGreaterThan(5);
    const meeting = await get<MeetingDto>(`/meetings/${GUEST_MEETING_IDS.weeklySync}`);
    expect(meeting.summaries?.[0]?.content?.decisions.length).toBeGreaterThan(0);
    expect(meeting.actionItems?.length).toBeGreaterThan(0);
    const messages = await get<{ items: Array<{ body: string }>; hasMore: boolean }>("/channels/ch_general/messages", { limit: "50" });
    expect(messages.items.length).toBeGreaterThan(3);
    expect((await get<unknown[]>("/comments", { resourceType: "DOCUMENT", resourceId: GUEST_DOCUMENT_IDS.designDoc })).length).toBeGreaterThan(0);
  });

  it("keeps writes in memory", async () => {
    const task = await send<TaskDto>("POST", `/projects/${GUEST_PROJECT_IDS.launch}/tasks`, { title: "Try guest mode", status: "todo" });
    expect(task.key).toMatch(/^LAUNCH-\d+$/);
    const moved = await send<TaskDto>("POST", `/tasks/${task.id}/move`, { status: "done", beforeId: null, afterId: null });
    expect(moved.completedAt).not.toBeNull();
    await send("POST", "/channels/ch_general/messages", { body: "Hello from a guest" });
    const messages = await get<{ items: Array<{ body: string }> }>("/channels/ch_general/messages");
    expect(messages.items.at(-1)?.body).toBe("Hello from a guest");
    const fav = await send<{ favorite: boolean }>("POST", "/users/me/favorites", { resourceType: "CANVAS", resourceId: GUEST_CANVAS_IDS.roadmap });
    expect(fav.favorite).toBe(true);
    // New resources get IDs whose pages exist in the static export.
    const canvas = await send<{ id: string }>("POST", "/canvases", { workspaceId: GUEST_WORKSPACE_ID, title: "Scratch" });
    expect(GUEST_SPARE_IDS.canvas).toContain(canvas.id);
  });

  it("answers unknown endpoints with an empty result instead of failing", async () => {
    const res = await get<unknown[] & { items: unknown[] }>("/does/not/exist");
    expect(res).toHaveLength(0);
    expect(res.items).toEqual([]);
    await expect(send("POST", "/does/not/exist")).resolves.toEqual({ ok: true });
  });

  it("reports missing resources as 404s", async () => {
    await expect(get("/projects/nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("static export params", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("are only defined for the static export build", async () => {
    vi.stubEnv("BASE_PATH", undefined as unknown as string);
    vi.resetModules();
    expect((await import("./static-params")).workspaceStaticParams).toBeUndefined();

    vi.stubEnv("BASE_PATH", "/collabspace");
    vi.resetModules();
    const params = await import("./static-params");
    expect(params.workspaceStaticParams?.()).toEqual([{ workspaceSlug: GUEST_WORKSPACE_SLUG }]);
    expect(params.canvasStaticParams?.()).toContainEqual({ canvasId: GUEST_CANVAS_IDS.brainstorm });
    expect(params.documentStaticParams?.()).toContainEqual({ documentId: GUEST_SPARE_IDS.document[0] });
  });
});
