# Deploying CollabSpace

CollabSpace is three long-running processes plus PostgreSQL and (optionally) Redis, S3-compatible storage and an SMTP provider.

| Process | Command | Port (default) | Notes |
| --- | --- | --- | --- |
| Web (Next.js) | `pnpm --filter @collabspace/web start` | 3000 | Proxies `/api/v1/*` to the API (`API_URL`). Can run on serverless platforms. |
| API (Express) | `pnpm --filter @collabspace/api start` | 4100 | Stateless; runs the AI job worker and maintenance timers. |
| Sync (WebSocket) | `pnpm --filter @collabspace/sync start` | 4101 | **Needs persistent connections** — run on a VM/container platform, not serverless. |

## 1. Build

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build              # builds API, sync (tsc) and web (next build)
```

Node 20+ is required at runtime. The API and sync services run their TypeScript sources through `tsx` (they import the workspace packages as source), so `pnpm build` type-checks them and `pnpm start` launches them; the web build is a standard Next.js output.

## 2. Database

```bash
DATABASE_URL=postgresql://user:pass@host:5432/collabspace pnpm db:deploy   # applies prisma/migrations
```

Run migrations before starting new API/sync instances. Yjs state is stored in `CollabDoc`/`CollabUpdate` (bytea); plan for storage growth proportional to editing activity (updates are compacted every 200 updates and automatic versions are pruned to the latest 50 per resource).

## 3. Environment variables

Copy `.env.example` and set at minimum:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (both API and sync). |
| `SESSION_SECRET` | ≥16 random chars; **must be identical** for API and sync (session cookies and share tokens are HMAC-hashed with it). |
| `INTERNAL_EVENT_SECRET` | Shared secret for API → sync internal calls. |
| `APP_URL`, `API_URL`, `SYNC_URL` | Public web URL, API URL (used by the web proxy), sync URL (used by the API). |
| `NEXT_PUBLIC_WS_URL` | Browser-visible WebSocket base, e.g. `wss://sync.example.com`. Baked in at `next build`. |
| `TRUSTED_ORIGINS` | Comma-separated origins allowed for cookie-authenticated mutations and WebSocket upgrades. |
| `COOKIE_SECURE=true` | Required behind HTTPS in production (also forced when `NODE_ENV=production`). |
| `REDIS_URL` | Optional. Enables cross-instance realtime fan-out and distributed rate limits. Required when running >1 sync instance. |
| `STORAGE_DRIVER` + `S3_*` | `s3` for production. `local` writes to `LOCAL_UPLOAD_DIR` (single instance only). |
| `EMAIL_DRIVER` + `SMTP_*` | `smtp` for real delivery; `log` prints emails to the API log. |
| `AI_PROVIDER` | `anthropic` (+ `ANTHROPIC_API_KEY`, `AI_MODEL`), `mock`, or `disabled`. |

Never commit `.env`. All secrets are read from the environment at startup; invalid configuration fails fast with a readable error.

## 4. Reverse proxy

Serve everything from one domain to keep the session cookie first-party:

```
https://app.example.com/           → web:3000
https://app.example.com/api/v1/*   → api:4100   (or let the Next.js rewrite proxy it)
wss://app.example.com/sync/*       → sync:4101  (then set NEXT_PUBLIC_WS_URL=wss://app.example.com/sync)
```

The sync service accepts paths `/yjs/<canvas|document>:<id>` and `/events`; when mounting under a prefix, strip it in the proxy. Set `trust proxy` is already enabled in the API (`X-Forwarded-For` is honoured for rate limiting and audit logs). WebSocket timeouts on the proxy should exceed the 30 s heartbeat.

## 5. Scaling

- **API**: horizontally scalable. Only one instance needs to run the AI worker/maintenance loop, but running it on all is safe (jobs are claimed atomically).
- **Sync**: horizontally scalable with Redis. Each instance keeps rooms in memory and relays Yjs updates and app events through Redis pub/sub. Use sticky sessions if possible to reduce duplicate room loads; correctness does not depend on it.
- **Database**: Yjs updates are appended per debounce window (400 ms) per room; connection pooling (PgBouncer) is recommended.

## 6. Health and observability

- `GET /health` on API (checks DB) and sync (room/connection counts).
- Platform admins see service status under `/admin/system`.
- Logs are JSON (pino) in production; set `LOG_LEVEL`.
- Audit trail: `/admin/audit-logs` (auth, sharing, permissions, AI usage, admin actions).

## 7. Docker Compose (reference)

The repository's `docker-compose.yml` provisions PostgreSQL and Redis for local development, with MinIO (`--profile storage`) and Mailpit (`--profile mail`) optional. For production, build images from each app and point them at managed Postgres/Redis/S3:

```Dockerfile
# apps/api (same pattern for apps/sync)
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @collabspace/api build
CMD ["pnpm", "--filter", "@collabspace/api", "start"]
```

## 8. Backups and retention

- Back up PostgreSQL (includes all collaborative content and versions) and the object storage bucket.
- Soft-deleted files are purged after 30 days by the API maintenance loop; sessions older than 7 days past expiry are removed.
- Version history retention: unlimited named checkpoints, 50 automatic checkpoints per resource.

## 9. Security checklist

- HTTPS everywhere; `COOKIE_SECURE=true`.
- Rotate `SESSION_SECRET` only with a maintenance window (invalidates all sessions and share links).
- Keep `TRUSTED_ORIGINS` tight; it gates CSRF and WebSocket origin checks.
- Restrict `/admin` to platform admins (enforced server-side via `platformRole`).
- Review the AI provider's data policy; the app documents what is sent at `/admin/system` and in the summary consent dialog.
