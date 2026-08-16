# AGENTS.md

This file documents essential information for agents working in this codebase.

## Quick Commands

| Command | What it does |
|---|---|
| `npm run build` | Compile via tsdown → `dist/main.mjs`, `dist/main.cjs`, `dist/main.d.mts`, `dist/main.d.cts` |
| `npm test` | Build + run node:test with c8 coverage |
| `npm run dev` | Build + run `test/sample.ts` (integration demo) |
| `npm run prettier` | Format all source files (run before committing) |
| `docker-compose up -d redis` | Start Redis container |

**Prerequisite:** Redis must be running. Copy `.env.template` → `.env` with `REDIS_URL` and `SQLITE_PATH`.

---

## Core Architecture

An outbox-pattern event bus: events are written to SQLite **before** publishing to Redis, guaranteeing at-least-once delivery even if Redis restarts.

### State Machine

```text
PENDING → PROCESSING → COMPLETED
           │
           └── (retry × 10) → DEAD → (deleted via perish)
```

### Key Implementation Details

- **Publish flow**: INSERT PENDING → immediate Redis publish → `setTimeout(10s).unref()` safety net re-checks if still PENDING.
- **Subscribe flow**: On Redis receive → mark PROCESSING → run handler → mark COMPLETED. On error: if `retries > maxRetries` mark DEAD, else increment retries and schedule re-publish with exponential backoff.
- **Recall APIs**: `recallOutgoingOutboxes()` re-publishes non-COMPLETED/DEAD events. `recallDeadOutboxes()` re-publishes DEAD events without changing status. `perishDeadOutboxes(maxAgeDays=7)` deletes old DEAD rows. All filter by `publisherName`.

---

## Non-Obvious Gotchas (Learn These)

- **`pubsub` receives object, not Redis URL**: The API takes a `PubSub` interface, not a Redis URL. Consumers create their own Redis clients and pass `{ publish, subscribe, tryClose }`.
- **Redis `.bind()` needed**: Redis client methods lose `this` when destructured — always `.bind()` them or wrap in arrow functions.
- **`createPersistentBus` is synchronous**: No `await` needed. `publish()` returns a promise; `subscribe()` does not.
- **`retries` comparison differs**: `recallOutgoingOutboxes` uses `>= maxRetries` to skip; subscriber catch uses `> maxRetries` to dead-letter.
- **`pendingDelayMs` is a safety net**: The initial publish fires immediately. The timer only acts if the event remains PENDING.
- **All `setTimeout` must `.unref()`**: Otherwise they block process exit.
- **SQL in `.sql` files**: Loaded as text via tsdown `loader`, parsed by `-- name:` annotations at runtime. Changing SQL requires recompilation.
- **`tryClose` is idempotent**: Guarded by `isClosing` — safe to call multiple times.
- **Tests import from `dist/main.mjs`** (compiled), but can import `src/` utilities with `.ts` extension thanks to `--experimental-strip-types`.
- **SQLite database is persistent**: If the file is removed, all event history is lost. Treat it as part of your data backup strategy.

---

## Code Organization & Conventions

- **Never organize imports manually** — run `npm run prettier` instead.
- **Test setup**: `scripts/test.sh` uses c8 with `--experimental-strip-types`, `--enable-source-maps`, and `--test-concurrency=4`.
- **Build**: tsdown compiles `src/main.ts` to ESM and CJS. SQL files are loaded as text via custom loader.
- **Error handling**: Error messages are stored as strings in the `error` column; use `errorToString()` utility for consistent formatting.
- **Retry logic**: Exponential backoff with jitter, capped at 60s.

### File Map

- `src/main.ts` — Public exports
- `src/service/bus.ts` — Core `createPersistentBus` implementation
- `src/broker/events.ts` — Type definitions (`EventEnvelope`, `PubSub`, etc.)
- `src/db.ts` — SQLite connection singleton (caches DBs by path)
- `src/sql/outbox.table.sql` — SQL statements (compiled via tsdown loader)
- `src/utils/utility.ts` — Helper functions (`sleep`, `calculateRetryDelay`, `errorToString`)
- `test/sample.ts` — Integration demo
- `test/*.test.ts` — Unit/integration tests (import from `dist/`)

---

## Common Issues & Fixes

| Problem | Solution |
|---|---|
| Tests fail with "cannot find module" | Run `npm run build` first; tests import from `dist/` |
| Redis connection errors | Start Redis via `docker-compose up -d redis` |
| SQL changes not taking effect | Recompile with `npm run build` |
| Import errors in tests | Use `.ts` extension for source imports; `--experimental-strip-types` allows this |
