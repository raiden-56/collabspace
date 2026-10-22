# CollabSpace — Real-Time Collaboration Studio

Monorepo (pnpm) with a Next.js 16 web app, an Express 5 REST API, a dedicated Yjs/WebSocket sync service, PostgreSQL via Prisma 6, and optional Redis / S3 / SMTP.

```
apps/web        Next.js App Router frontend (Tailwind v4, Radix, Tiptap, react-konva, dnd-kit, Zustand, TanStack Query)
apps/api        Express REST API, OpenAPI docs at /api/v1/docs, AI job worker, automation engine
apps/sync       WebSocket service: Yjs rooms (y-websocket compatible) + JSON app events (presence, chat, notifications)
packages/db     Prisma schema, client, Yjs persistence primitives (@collabspace/db/collab)
packages/shared Zod schemas, permission engine, realtime event protocol, canvas object model, templates, Tiptap schema
e2e             Playwright (scaffold)
```

## Quick start

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env            # defaults work for local dev (Postgres on 5434, API 4100, sync 4101, web 3000)
pnpm install
docker compose up -d postgres redis        # add `--profile storage --profile mail` for MinIO + Mailpit
pnpm db:generate && pnpm db:migrate
pnpm dev                                   # api + sync + web
```

Open http://localhost:3000. Register, create a workspace (optionally with demo content), and open a canvas in two browser windows to see live collaboration.

- API docs: http://localhost:4100/api/v1/docs
- Sync health: http://localhost:4101/health
- Email: with `EMAIL_DRIVER=log` emails are logged; verification/reset/invite links are returned in API responses in non-production.
- AI: `AI_PROVIDER=mock` works offline; set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` for real summaries.
- Storage: `STORAGE_DRIVER=local` writes to `./uploads`; `s3` uses the MinIO/S3 settings.

## Tests

```bash
pnpm --filter @collabspace/shared test             # unit: permissions, dependencies, canvas serialization/templates (24 tests)
pnpm --filter @collabspace/api test:integration    # auth, workspaces, invitations, tasks, versions, sharing, meetings+AI, search (15 tests)
pnpm --filter @collabspace/sync test:integration   # two Yjs clients converge, unauthorized rejected, read-only share links, offline resync (4 tests)
pnpm e2e                                           # Playwright: the 19-step workflow from the spec in two real browser sessions (8 tests)
```

Integration tests need the Postgres container running (they use `DATABASE_URL` from `.env`). The Playwright suite needs the full stack running (`pnpm dev`) and a browser (`pnpm --filter @collabspace/e2e install-browsers`). Behind a TLS-intercepting proxy the browser download may need `NODE_TLS_REJECT_UNAUTHORIZED=0` for that one command.

## Architecture notes

- **Auth**: Argon2id passwords, opaque session tokens (HMAC-hashed in DB) in an HttpOnly SameSite=Lax cookie; Origin check on mutations. Next.js proxies `/api/v1` so cookies stay first-party; the sync service validates the same cookie on WebSocket upgrade.
- **Permissions**: workspace roles (owner/admin/member/guest) → project membership → resource visibility + explicit grants (viewer/commenter/editor) + share links (unguessable token, expiry, revocation, optional sign-in). Enforced identically in REST (`services/access.ts`) and WebSocket (`apps/sync/src/auth.ts`) using `computeResourceAccess` from `packages/shared`.
- **Collaboration**: one Yjs doc per canvas/document. Sync service persists each update to `CollabUpdate`, compacts into `CollabDoc`, creates automatic versions every 10 minutes; restore writes the old state into the live doc so clients converge. Read-only clients' updates are dropped server-side and resynced.
- **Realtime app events**: typed protocol in `packages/shared/src/events.ts`; API publishes via Redis pub/sub (multi-instance) or HTTP fallback.
- **AI**: provider adapter (anthropic | mock | disabled), DB-backed job queue with retries, action items are drafts until a human converts them; assistant proposes actions that require confirmation; all AI usage audited.

## Status

All layers are implemented and verified: schema + migration, REST API (84 documented endpoints), sync service, web app (marketing site, auth, onboarding, shell, workspace overview, projects, infinite canvas, collaborative documents, tasks with list/board/timeline/calendar, meetings with AI summaries and action-item review, team chat, files, members, analytics, settings and automation, inbox, search, templates, admin). `pnpm -r typecheck`, the unit/integration suites, `next build` and the Playwright suite all pass.

Seed a demo workspace with `pnpm db:seed` (logins printed by the script). See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment.

Known limitations: audio recording/transcription and external calendar sync are not implemented (the UI says so); the AI assistant uses an offline mock provider unless `AI_PROVIDER=anthropic` is configured; lint reports React Compiler advisories as warnings.
