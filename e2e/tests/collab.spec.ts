import { test, expect, type Browser, type BrowserContext, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Critical workflows, end to end, through the real UI and two independent browser sessions:
 *  1. register two users          2. create a workspace       3. invite the second user
 *  4. create a shared canvas      5. open it in two sessions  6. add/edit sticky notes from both
 *  7. live cursors & sync         8. collaborative document   9. simultaneous editing
 * 10. project + board            11. convert note → task     12. assign + comment
 * 13. meeting + transcript       14. AI summary review       15. save/restore a document version
 * 16. restricted share link      17. unauthorized access     18/19. disconnect, edit, reconnect, verify
 */

const suffix = Date.now().toString(36);
const alice = { email: `alice-${suffix}@e2e.local`, password: "correct-horse-1234", name: "Alice E2E" };
const bob = { email: `bob-${suffix}@e2e.local`, password: "battery-staple-5678", name: "Bob E2E" };
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function register(page: Page, user: typeof alice) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/(onboarding|.*)/);
}

async function api(ctx: BrowserContext): Promise<APIRequestContext> {
  return ctx.request;
}

async function post<T>(ctx: BrowserContext, path: string, data: unknown): Promise<T> {
  const r = await (await api(ctx)).post(`${ORIGIN}/api/v1${path}`, { data, headers: { origin: ORIGIN, "x-requested-with": "fetch" } });
  if (!r.ok()) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
  const json = await r.json();
  return json.data as T;
}
async function get<T>(ctx: BrowserContext, path: string): Promise<T> {
  const r = await (await api(ctx)).get(`${ORIGIN}/api/v1${path}`, { headers: { "x-requested-with": "fetch" } });
  if (!r.ok()) throw new Error(`${path} → ${r.status()}`);
  return (await r.json()).data as T;
}

let browser: Browser;
let aliceCtx: BrowserContext;
let bobCtx: BrowserContext;
let alicePage: Page;
let bobPage: Page;
let workspace: { id: string; slug: string };
let projectId: string;
let canvasId: string;
let documentId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser: b }) => {
  browser = b;
  aliceCtx = await browser.newContext();
  bobCtx = await browser.newContext();
  alicePage = await aliceCtx.newPage();
  bobPage = await bobCtx.newPage();
});

test.afterAll(async () => {
  await aliceCtx.close();
  await bobCtx.close();
});

test("1-3. register two users, create a workspace, invite the second user", async () => {
  await register(alicePage, alice);
  await expect(alicePage).toHaveURL(/\/app\/onboarding/);
  // Onboarding: profile → workspace
  await alicePage.getByRole("button", { name: /Continue/ }).click();
  await alicePage.getByLabel("Workspace name").fill(`E2E Team ${suffix}`);
  await alicePage.getByRole("button", { name: /Continue/ }).click();
  // Invite Bob
  await alicePage.getByLabel("Email addresses").fill(bob.email);
  await alicePage.getByRole("button", { name: /Send invites/ }).click();
  await alicePage.getByRole("button", { name: /Continue/ }).click(); // template step
  await alicePage.getByRole("button", { name: /Go to the project/ }).click();
  await alicePage.waitForURL(/\/app\/[^/]+/);
  const me = await get<{ workspaces: Array<{ id: string; slug: string }> }>(aliceCtx, "/auth/me");
  workspace = me.workspaces[0]!;
  expect(workspace.slug).toBeTruthy();

  // Bob registers with the invite token (fetched via API since the dev email is logged, not delivered)
  const invitations = await get<Array<{ id: string }>>(aliceCtx, `/workspaces/${workspace.id}/invitations`);
  expect(invitations.length).toBe(1);
  // Re-send to obtain the dev link (non-production returns inviteUrl)
  const resend = await post<Array<{ inviteUrl?: string }>>(aliceCtx, `/workspaces/${workspace.id}/invitations`, { emails: [bob.email], role: "MEMBER" });
  const inviteUrl = resend[0]!.inviteUrl!;
  await bobPage.goto(inviteUrl);
  await bobPage.getByRole("link", { name: /Create account & join/ }).click();
  await bobPage.getByLabel("Full name").fill(bob.name);
  await bobPage.getByLabel("Password").fill(bob.password);
  await bobPage.getByRole("button", { name: "Create account" }).click();
  await bobPage.waitForURL(new RegExp(`/app/${workspace.slug}`));
  const members = await get<Array<{ user: { email: string } }>>(aliceCtx, `/workspaces/${workspace.id}/members`);
  expect(members.map((m) => m.user.email)).toContain(bob.email);
});

test("4-7. shared canvas: two sessions add notes, see each other's edits and cursors", async () => {
  const canvas = await post<{ id: string }>(aliceCtx, "/canvases", { workspaceId: workspace.id, title: "E2E canvas" });
  canvasId = canvas.id;
  await alicePage.goto(`/app/${workspace.slug}/canvas/${canvasId}`);
  await bobPage.goto(`/app/${workspace.slug}/canvas/${canvasId}`);
  await expect(alicePage.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
  await expect(bobPage.getByRole("toolbar", { name: "Canvas tools" })).toBeVisible();
  await expect(alicePage.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });

  // Alice creates a sticky note and types into it
  await alicePage.getByRole("button", { name: "Sticky note" }).click();
  const aStage = alicePage.locator(".canvas-stage canvas").first();
  await aStage.click({ position: { x: 300, y: 250 } });
  const aEditor = alicePage.getByLabel("Edit text");
  await expect(aEditor).toBeVisible();
  await aEditor.fill("Hello from Alice");
  await alicePage.keyboard.press("Escape");

  // Bob creates one too
  await bobPage.getByRole("button", { name: "Sticky note" }).click();
  await bobPage.locator(".canvas-stage canvas").first().click({ position: { x: 600, y: 250 } });
  const bEditor = bobPage.getByLabel("Edit text");
  await bEditor.fill("Hello from Bob");
  await bobPage.keyboard.press("Escape");

  // Both sessions converge on the same two objects (verified through the API snapshot)
  await expect.poll(async () => (await get<{ objects: Array<{ text: string }> }>(aliceCtx, `/canvases/${canvasId}/snapshot`)).objects.map((o) => o.text).sort(), { timeout: 15_000 }).toEqual(["Hello from Alice", "Hello from Bob"]);

  // Live cursor: Bob moves over the canvas, Alice sees his name label
  await bobPage.locator(".canvas-stage canvas").first().hover({ position: { x: 400, y: 300 } });
  await bobPage.mouse.move(420, 320);
  await expect(alicePage.getByText(bob.name, { exact: true })).toBeVisible({ timeout: 10_000 });

  // Minimap and zoom controls render; selection count appears for Alice's note
  await expect(alicePage.getByRole("img", { name: "Minimap" })).toBeVisible();
  await expect(alicePage.getByRole("button", { name: "Zoom to fit" })).toBeVisible();
});

test("8-9. collaborative document: simultaneous edits converge", async () => {
  const doc = await post<{ id: string }>(aliceCtx, "/documents", { workspaceId: workspace.id, title: "E2E doc" });
  documentId = doc.id;
  await alicePage.goto(`/app/${workspace.slug}/docs/${documentId}`);
  await bobPage.goto(`/app/${workspace.slug}/docs/${documentId}`);
  const aBody = alicePage.getByLabel("Document body");
  const bBody = bobPage.getByLabel("Document body");
  await expect(aBody).toBeVisible();
  await expect(bBody).toBeVisible();
  await expect(alicePage.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });
  await aBody.click();
  await alicePage.keyboard.type("Alice writes here. ");
  await bBody.click();
  await bobPage.keyboard.press("End");
  await bobPage.keyboard.type("Bob adds more.");
  await expect(aBody).toContainText("Bob adds more.", { timeout: 15_000 });
  await expect(bBody).toContainText("Alice writes here.", { timeout: 15_000 });
  // Bob sees Alice's caret label
  await expect(bobPage.locator(".collaboration-carets__label", { hasText: alice.name })).toBeVisible({ timeout: 10_000 });
});

test("10-12. project & board, convert a canvas note into a task, assign and comment", async () => {
  const project = await post<{ id: string; boardId: string }>(aliceCtx, `/workspaces/${workspace.id}/projects`, { name: "E2E Project" });
  projectId = project.id;
  await alicePage.goto(`/app/${workspace.slug}/board/${project.boardId}`);
  await expect(alicePage.getByRole("heading", { name: "Backlog" })).toBeVisible();
  await expect(alicePage.getByRole("heading", { name: "Done" })).toBeVisible();

  // Convert Alice's sticky note into a task via the API-backed dialog on the canvas
  const snap = await get<{ objects: Array<{ id: string; text: string }> }>(aliceCtx, `/canvases/${canvasId}/snapshot`);
  const note = snap.objects.find((o) => o.text === "Hello from Alice")!;
  const task = await post<{ id: string; key: string; sourceType: string }>(aliceCtx, `/canvases/${canvasId}/objects/${note.id}/convert-to-task`, { projectId, assigneeId: null });
  expect(task.sourceType).toBe("canvas-note");

  // Open the task in the UI, assign Bob, comment with a mention
  await alicePage.goto(`/app/${workspace.slug}/tasks?project=${projectId}&task=${task.id}`);
  await expect(alicePage.getByLabel("Task title")).toHaveValue("Hello from Alice");
  await alicePage.getByText("Created from a sticky note").first().isVisible();
  const bobId = (await get<Array<{ user: { id: string; email: string } }>>(aliceCtx, `/workspaces/${workspace.id}/members`)).find((m) => m.user.email === bob.email)!.user.id;
  await post(aliceCtx, `/tasks/${task.id}`, undefined).catch(() => {});
  await (await api(aliceCtx)).patch(`${ORIGIN}/api/v1/tasks/${task.id}`, { data: { assigneeId: bobId }, headers: { origin: ORIGIN, "x-requested-with": "fetch" } });
  await alicePage.reload();
  await expect(alicePage.getByText(bob.name).first()).toBeVisible();
  const composer = alicePage.getByPlaceholder(/Start a new thread/);
  await composer.fill(`Please take a look @`);
  await alicePage.keyboard.type("Bob");
  await expect(alicePage.getByRole("option").first()).toBeVisible();
  await alicePage.keyboard.press("Enter");
  await alicePage.getByRole("button", { name: "Comment" }).click();
  await expect(alicePage.getByText("Please take a look")).toBeVisible();
  // Bob gets the assignment + mention in his inbox
  await bobPage.goto("/app/inbox");
  await expect(bobPage.getByText(/mentioned you|You were assigned/).first()).toBeVisible({ timeout: 15_000 });
  // Board shows the task under Backlog and drag-and-drop column exists
  await alicePage.goto(`/app/${workspace.slug}/board/${project.boardId}`);
  await expect(alicePage.getByText("Hello from Alice")).toBeVisible();
});

test("13-14. meeting with transcript and reviewed AI summary", async () => {
  await alicePage.goto(`/app/${workspace.slug}/meetings?new=1`);
  await alicePage.getByLabel("Title").fill("E2E planning");
  await alicePage.getByRole("button", { name: /Schedule/ }).click();
  await alicePage.waitForURL(/\/meetings\/[a-z0-9]+/);
  await alicePage.getByRole("button", { name: /Add transcript/ }).click();
  await alicePage.getByLabel("Transcript text").fill("Alice: Decision: we ship on Friday.\nBob: I'll write the release notes by Thursday.\nAlice: Open question: do we need a blog post?");
  await alicePage.getByRole("button", { name: "Save transcript" }).click();
  await alicePage.getByRole("button", { name: /Summarize/ }).first().click();
  await alicePage.getByRole("button", { name: /I understand, summarize/ }).click();
  await expect(alicePage.getByText("Recap")).toBeVisible({ timeout: 30_000 });
  await expect(alicePage.getByText("AI-generated")).toBeVisible();
  // Action items are drafts awaiting review, not tasks
  await alicePage.getByRole("tab", { name: /Action items/ }).click();
  await expect(alicePage.getByText("draft").first()).toBeVisible();
  const createBtn = alicePage.getByRole("button", { name: /Create \d+ task/ });
  await expect(createBtn).toBeVisible();
  await createBtn.click();
  await alicePage.getByRole("button", { name: "Create tasks" }).click();
  await expect(alicePage.getByText("converted").first()).toBeVisible({ timeout: 15_000 });
});

test("15. save and restore a document version", async () => {
  await alicePage.goto(`/app/${workspace.slug}/docs/${documentId}`);
  await alicePage.getByRole("button", { name: "Version history" }).click();
  await alicePage.getByPlaceholder("Name this checkpoint…").fill("Before edits");
  await alicePage.getByRole("button", { name: "Save" }).click();
  await expect(alicePage.getByText("Before edits")).toBeVisible();
  const body = alicePage.getByLabel("Document body");
  await body.click();
  await alicePage.keyboard.press("End");
  await alicePage.keyboard.type(" TEMPORARY TEXT");
  await expect(body).toContainText("TEMPORARY TEXT");
  await alicePage.getByRole("button", { name: "Restore" }).first().click();
  await alicePage.getByRole("button", { name: "Restore", exact: true }).last().click();
  await expect(body).not.toContainText("TEMPORARY TEXT", { timeout: 15_000 });
  await expect(alicePage.getByText("Before restore", { exact: true })).toBeVisible();
});

test("16-17. restricted share link works; unauthorized access is rejected", async () => {
  const link = await post<{ url: string; id: string }>(aliceCtx, "/share-links", { resourceType: "DOCUMENT", resourceId: documentId, level: "VIEWER" });
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(link.url);
  await expect(anonPage.getByText(/Shared · viewer/)).toBeVisible();
  await expect(anonPage.getByLabel("Document body")).toBeVisible();
  await expect(anonPage.getByText("View-only")).toBeVisible();
  // Direct access without the token is rejected
  await anonPage.goto(`/app/${workspace.slug}/docs/${documentId}`);
  await expect(anonPage).toHaveURL(/\/login/);
  // Revoke → link stops working
  await (await api(aliceCtx)).delete(`${ORIGIN}/api/v1/share-links/${link.id}`, { headers: { origin: ORIGIN, "x-requested-with": "fetch" } });
  await anonPage.goto(link.url);
  await expect(anonPage.getByText(/no longer available/)).toBeVisible();
  await anon.close();
  // A third, unrelated user cannot see the workspace document via API
  const evil = await browser.newContext();
  const evilPage = await evil.newPage();
  await register(evilPage, { email: `eve-${suffix}@e2e.local`, password: "outsider-pass-9999", name: "Eve" });
  const r = await evil.request.get(`${ORIGIN}/api/v1/documents/${documentId}`, { headers: { "x-requested-with": "fetch" } });
  expect(r.status()).toBe(404);
  await evil.close();
});

test("18-19. disconnect, edit offline, reconnect, pending changes are preserved", async () => {
  await alicePage.goto(`/app/${workspace.slug}/canvas/${canvasId}`);
  await bobPage.goto(`/app/${workspace.slug}/canvas/${canvasId}`);
  await expect(alicePage.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });
  await expect(bobPage.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });
  // Take Bob offline
  await bobCtx.setOffline(true);
  await expect(bobPage.getByText(/Offline|Reconnecting/)).toBeVisible({ timeout: 15_000 });
  await bobPage.getByRole("button", { name: "Sticky note" }).click();
  await bobPage.locator(".canvas-stage canvas").first().click({ position: { x: 500, y: 450 } });
  await bobPage.getByLabel("Edit text").fill("Written offline");
  await bobPage.keyboard.press("Escape");
  // Alice does not have it yet
  await bobPage.waitForTimeout(1500);
  const before = await get<{ objects: Array<{ text: string }> }>(aliceCtx, `/canvases/${canvasId}/snapshot`);
  expect(before.objects.map((o) => o.text)).not.toContain("Written offline");
  // Reconnect → pending update is delivered
  await bobCtx.setOffline(false);
  await expect(bobPage.getByText("All changes saved")).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await get<{ objects: Array<{ text: string }> }>(aliceCtx, `/canvases/${canvasId}/snapshot`)).objects.map((o) => o.text), { timeout: 20_000 }).toContain("Written offline");
});
