# AGENTS.md

This file documents essential information for agents working in this codebase.

## Codemem

MANDATORY: Before ANY file operation, load `.claude/skills/codemem/SKILL.md`. Save user decisions and preferences as `codemem` memories.

## Code Quality Rules

Never organize or group imports manually — run `npm run prettier` instead.

## Essential Commands

| Command | What it does |
|---|---|
| `npm run build` | Compile via tsdown → `dist/main.mjs`, `.cjs`, `.d.mts` |
| `npm test` | Build + `node --test` with c8 coverage. Imports from `dist/` — build first |
| `npm run dev` | Build + run `test/sample.ts` (Redis + SQLite integration test) |
| `npm run prettier` | Format all source files |

Tests require Redis running (see `compose.yml`). Copy `.env.template` → `.env` with `REDIS_URL` and `SQLITE_PATH`.

## Architecture

An outbox-pattern event bus: events are written to SQLite before publishing to Redis.

1. **Publish**: INSERT PENDING row → immediate Redis publish. Schedules `setTimeout(10s).unref()` safety net that re-checks and re-publishes if still PENDING.
2. **Subscribe**: On Redis receive → mark PROCESSING → run handler → mark COMPLETED. On handler error: if `retries > maxRetries` mark DEAD, else increment retries and schedule re-publish with exponential backoff.
3. **Recall**: `recallOutgoingOutboxes()` re-publishes non-COMPLETED/DEAD events. `recallDeadOutboxes()` re-publishes DEAD events without changing status. `perishDeadOutboxes(maxAgeDays=7)` deletes old DEAD rows. All recall/perish filter by `publisherName`.
4. **State machine**: PENDING → PROCESSING → COMPLETED or DEAD (after 10 retries).

## Non-obvious gotchas

- **`pubsub` receives object, not redisUrl**: The API takes a `PubSub` interface, not a Redis URL. Consumers create their own Redis clients and pass `{ publish, subscribe, tryClose }`.
- **Redis `.bind()` needed**: Redis client methods lose `this` when destructured — always `.bind()` them or wrap in arrow functions.
- **`createPersistentBus` is synchronous**: No `await` needed. `publish()` returns a promise; `subscribe()` does not.
- **`retries` comparison differs**: `recallOutgoingOutboxes` uses `>= maxRetries` to skip; subscriber catch uses `> maxRetries` to dead-letter.
- **`pendingDelayMs` is a safety net**: The initial publish fires immediately. The timer only acts if the event remains PENDING.
- **All `setTimeout` must `.unref()`**: Otherwise they block process exit.
- **SQL in `.sql` files**: Loaded as text via tsdown `loader`, parsed by `-- name:` annotations at runtime. Changing SQL requires recompilation.
- **`tryClose` is idempotent**: Guarded by `isClosing` — safe to call multiple times.
- **Tests import from `dist/main.mjs`** (compiled), but can import `src/` utilities with `.ts` extension thanks to `--experimental-strip-types`.
