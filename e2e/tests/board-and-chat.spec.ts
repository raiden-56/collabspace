import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Kanban drag-and-drop persistence and live chat delivery between two browser sessions.
 */
const suffix = Date.now().toString(36);
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const alice = { email: `kb-alice-${suffix}@e2e.local`, password: "correct-horse-1234", name: "Kanban Alice" };
const bob = { email: `kb-bob-${suffix}@e2e.local`, password: "battery-staple-5678", name: "Kanban Bob" };

async function register(page: Page, user: typeof alice) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app/);
}
async function post<T>(ctx: BrowserContext, path: string, data: unknown): Promise<T> {
  const r = await ctx.request.post(`${ORIGIN}/api/v1${path}`, { data, headers: { origin: ORIGIN, "x-requested-with": "fetch" } });
  if (!r.ok()) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
  return (await r.json()).data as T;
}
async function get<T>(ctx: BrowserContext, path: string): Promise<T> {
  const r = await ctx.request.get(`${ORIGIN}/api/v1${path}`, { headers: { "x-requested-with": "fetch" } });
  return (await r.json()).data as T;
}

let browser: Browser;
let aliceCtx: BrowserContext;
let bobCtx: BrowserContext;
let alicePage: Page;
let bobPage: Page;
let ws: { id: string; slug: string };
let boardId: string;
let taskId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser: b }) => {
  browser = b;
  aliceCtx = await browser.newContext();
  bobCtx = await browser.newContext();
  alicePage = await aliceCtx.newPage();
  bobPage = await bobCtx.newPage();
  await register(alicePage, alice);
  ws = await post(aliceCtx, "/workspaces", { name: `Kanban ${suffix}` });
  const invites = await post<Array<{ inviteUrl: string }>>(aliceCtx, `/workspaces/${ws.id}/invitations`, { emails: [bob.email], role: "MEMBER" });
  await bobPage.goto(invites[0]!.inviteUrl);
  await bobPage.getByRole("link", { name: /Create account & join/ }).click();
  await bobPage.getByLabel("Full name").fill(bob.name);
  await bobPage.getByLabel("Password").fill(bob.password);
  await bobPage.getByRole("button", { name: "Create account" }).click();
  await bobPage.waitForURL(new RegExp(`/app/${ws.slug}`));
  const project = await post<{ id: string; boardId: string }>(aliceCtx, `/workspaces/${ws.id}/projects`, { name: "Drag project" });
  boardId = project.boardId;
  const t = await post<{ id: string }>(aliceCtx, `/projects/${project.id}/tasks`, { title: "Drag me", status: "todo" });
  taskId = t.id;
});

test.afterAll(async () => {
  await aliceCtx.close();
  await bobCtx.close();
});

test("dragging a card to another column persists the new status and ordering", async () => {
  await alicePage.goto(`/app/${ws.slug}/board/${boardId}`);
  const card = alicePage.getByText("Drag me", { exact: true });
  await expect(card).toBeVisible();
  const target = alicePage.getByRole("heading", { name: "In Progress" });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  expect(from && to).toBeTruthy();
  await alicePage.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await alicePage.mouse.down();
  await alicePage.mouse.move(from!.x + 20, from!.y + 20, { steps: 5 });
  await alicePage.mouse.move(to!.x + 60, to!.y + 120, { steps: 15 });
  await alicePage.mouse.move(to!.x + 60, to!.y + 130, { steps: 5 });
  await alicePage.mouse.up();
  await expect.poll(async () => (await get<{ status: string }>(aliceCtx, `/tasks/${taskId}`)).status, { timeout: 15_000 }).toBe("in_progress");
  // Bob sees the move live without reloading
  await bobPage.goto(`/app/${ws.slug}/board/${boardId}`);
  await expect(bobPage.getByText("Drag me", { exact: true })).toBeVisible();
  await post(aliceCtx, `/tasks/${taskId}/move`, { status: "done" });
  await expect.poll(async () => bobPage.locator("div", { hasText: /^Done/ }).first().isVisible(), { timeout: 15_000 }).toBeTruthy();
  await expect(bobPage.getByRole("heading", { name: "Done" }).locator("..").locator("..").getByText("Drag me")).toBeVisible({ timeout: 15_000 });
});

test("chat messages are delivered live to another session, with mentions and reactions", async () => {
  await alicePage.goto(`/app/${ws.slug}/chat`);
  await bobPage.goto(`/app/${ws.slug}/chat`);
  await expect(alicePage.getByRole("heading", { name: "general" })).toBeVisible();
  await expect(bobPage.getByRole("heading", { name: "general" })).toBeVisible();
  const composer = alicePage.getByPlaceholder("Message #general");
  await composer.fill(`Hello Bob, live from Alice ${suffix}`);
  await alicePage.keyboard.press("Enter");
  await expect(bobPage.getByText(`Hello Bob, live from Alice ${suffix}`)).toBeVisible({ timeout: 15_000 });
  // Bob replies with a mention
  const bobComposer = bobPage.getByPlaceholder("Message #general");
  await bobComposer.fill("Got it @");
  await bobPage.keyboard.type("Kanban A");
  await expect(bobPage.getByRole("option").first()).toBeVisible();
  await bobPage.keyboard.press("Enter");
  await bobPage.keyboard.press("Enter");
  await expect(alicePage.getByText("@Kanban Alice")).toBeVisible({ timeout: 15_000 });
  // Alice reacts; Bob sees the reaction
  const msg = alicePage.getByText("Got it").first();
  await msg.hover();
  await alicePage.getByRole("button", { name: "Add reaction" }).first().click();
  await alicePage.getByRole("button", { name: "React 👍" }).click();
  await expect(bobPage.getByRole("button", { name: /👍 1/ })).toBeVisible({ timeout: 15_000 });
  // Alice's inbox got the mention
  await alicePage.goto("/app/inbox");
  await expect(alicePage.getByText(/mentioned you/).first()).toBeVisible({ timeout: 15_000 });
});
