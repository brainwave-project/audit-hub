# audit-hub

Immutable audit trail service for the Brainwave platform. Consumes domain events from all three service topics on Kafka and persists them to a dedicated PostgreSQL schema. Exposes read-only REST endpoints for querying activity logs — scoped per user or across the whole platform.

## Responsibilities

- Kafka consumer subscribed to `brainwave.auth.events`, `brainwave.user.events`, and `brainwave.document.events`
- Idempotent event persistence — duplicate messages are silently skipped via `eventId` unique constraint
- Per-user activity query (`/api/audit/activity/me`) — scoped to the authenticated user's Keycloak sub
- Admin activity query (`/api/audit/activity`) — full platform log with pagination and filtering
- Health, readiness, and Prometheus metrics endpoints

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (ESM) |
| HTTP | Express 4 |
| Database | PostgreSQL 16 — schema `audit` |
| ORM | Prisma 5 |
| Events | Kafka consumer (`kafkajs`) |
| Observability | pino (structured JSON logs) · prom-client (metrics) |
| Shared library | `@brainwave-project/core` |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/audit/activity/me` | Current user's own activity (paginated + filtered) |
| GET | `/api/audit/activity` | All platform activity — admin view (paginated + filtered) |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/metrics` | Prometheus scrape endpoint |
| GET | `/api/docs` | Swagger UI |

### Query Parameters (both activity endpoints)

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer | Page size (1–100, default: 20) |
| `offset` | integer | Skip N records (default: 0) |
| `action` | string | Filter by action — e.g. `DOCUMENT_UPLOADED`, `LOGIN_SUCCESS` |
| `service` | string | Filter by source service — `auth-hub`, `user-hub`, `know-hub` |
| `outcome` | string | `SUCCESS` or `FAILURE` |
| `from` | ISO 8601 | Start of date range on `occurredAt` |
| `to` | ISO 8601 | End of date range on `occurredAt` |
| `userId` | string | *(admin endpoint only)* Filter by actor's Keycloak sub |

## Kafka Topics Consumed

| Topic | Consumer Group | Events |
|---|---|---|
| `brainwave.auth.events` | `brainwave.audit-hub` | LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, TOKEN_REFRESHED |
| `brainwave.user.events` | `brainwave.audit-hub` | USER_CREATED, USER_STATUS_CHANGED, USER_ROLES_ASSIGNED, USER_DELETED |
| `brainwave.document.events` | `brainwave.audit-hub` | DOCUMENT_UPLOADED, DOCUMENT_DOWNLOADED, DOCUMENT_ARCHIVED, DOCUMENT_DELETED, NOTE_CREATED |

Idempotency is enforced at the database level — `eventId` has a `UNIQUE` constraint. Duplicate Kafka deliveries are silently ignored (Prisma `P2002`).

## Data Model

Each persisted event captures:

```
eventId        — deduplication key (UUID, from Kafka message key)
occurredAt     — ISO 8601 timestamp from the emitting service
actor          — { userId, email, roles } — Keycloak sub of the acting user
action         — e.g. DOCUMENT_UPLOADED
service        — source service (auth-hub | user-hub | know-hub)
resource       — { type, id, name } — optional, absent for session events
outcome        — SUCCESS | FAILURE
correlationId  — links event to request logs and traces
metadata       — JSONB — per-event context (old/new state, sizes, counts)
```

## Development

```bash
cp .env.example .env
npm install
npx prisma generate       # generate Prisma client
npm run dev               # tsx watch mode
```

> The `audit` schema is bootstrapped by `infra/postgres/init/04-audit.sql` on first Postgres start. You do not need to run `prisma db push` — the schema is pre-created by the init SQL.

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with hot reload (`nodemon` + `tsx`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:studio` | Open Prisma Studio |

## Docker

```bash
docker build -t audit-hub .
docker run -p 3003:3003 --env-file .env audit-hub
```

## CI/CD

On push to `main`, GitHub Actions builds the Docker image and pushes it to:
```
ghcr.io/brainwave-project/brainwave-audit-hub:latest
```
Semantic Release handles versioning via Conventional Commits.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3003` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (uses `audit` schema) |
| `KAFKA_BROKERS` | No | `kafka:9092` | Comma-separated Kafka broker list |
| `KAFKA_GROUP_ID` | No | `brainwave.audit-hub` | Kafka consumer group ID |
| `LOG_LEVEL` | No | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |

## License

MIT © Ahmad Awad
