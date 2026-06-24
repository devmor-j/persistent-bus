# AGENTS.md

This file documents essential information for agents working in this codebase to help them work effectively and avoid trial-and-error discovery.

## Codemem

MANDATORY: Before ANY file operation, load `.claude/skills/codemem/SKILL.md`. No exceptions.

MEMORY RULE: Save user decisions, preferences, and project rules as `codemem` memories.
If I say "always do X" or "I prefer Y" — store it.

## Code Quality Rules

- Never organize or group imports, instead run `npm run prettier` before done.

## Project Overview

This is a Node.js library called `persistent-bus` that implements a typed, resilient event bus with at-least-once delivery semantics. It ensures no messages are lost during broker restarts or crashes by storing events in SQLite before publishing to Redis.

## Key Components

- **Broker**: Handles Redis pub/sub operations using the `redis` library.
- **SQLite**: Manages persistence using native `node:sqlite` (DatabaseSync).
- **Service**: Implements the core persistent bus logic (outbox pattern).
- **Utils**: Utility functions for retries, delays, and error handling.

## Architecture and Control Flow

1. **Publishing**:
   - Event is stored in SQLite as a `PENDING` outbox row, then a `setTimeout(retryIfPending, pendingDelayMs).unref()` is scheduled as a safety net (checks if event is still `PENDING` later and retries).
   - Initial publish to Redis happens immediately after.
   - `retryIfPending`: if event is still `PENDING` when triggered, increments retries and re-publishes. If retries exceed `maxRetries`, marks event `DEAD` ("retry:dead"). On publish failure, **decrements** retries (undo).
2. **Subscribing**:
   - Subscriber receives from Redis → marks `PROCESSING` → runs handler → marks `COMPLETED`.
   - On handler failure: if `retries > maxRetries`, marks `DEAD` with error message. Otherwise increments retries and schedules a re-publish with exponential backoff.
   - **Foreign event handling**: If the received event has no matching row in this bus's SQLite (published by another instance), the error is silently swallowed.
3. **Recall API**:
   - `recallOutgoingOutboxes()` — iterates all non-`COMPLETED`/`DEAD` events for this publisher. Skips those at `>= maxRetries`. Pre-increments retries, publishes, decrements on failure. Sleeps `recallIntervalMs` between each.
   - `recallDeadOutboxes()` — re-publishes `DEAD` events. Does NOT change status or retries regardless of outcome. Sleeps `recallIntervalMs` between each.
   - `perishDeadOutboxes(maxAgeDays = 7)` — deletes `DEAD` events older than `maxAgeDays`. Pass `0` to delete all `DEAD` events regardless of age.
   - All recall functions filter by `publisherName` — each bus instance only sees its own events.
4. **Dead Lettering**:
   - Events whose retries exceed `maxRetries` (default 10) are marked `DEAD`. Statuses: `PENDING` → `PROCESSING` → `COMPLETED` or `DEAD`.

## Essential Commands

- `npm run build` — Compile via tsdown (outputs `dist/main.mjs`, `dist/main.cjs`, types).
- `npm run dev` — Build then run `sample.ts` (integration test requiring Redis/SQLite).
- `npm test` — Build then run `node --test` with coverage (`scripts/test.sh`). Tests import from `dist/main.mjs`, so build must run first.
- `npm run prettier` — Format with Prettier (includes `prettier-plugin-organize-imports`).

## Version Targets

| Config | Value | Rationale |
|---|---|---|
| Node.js (engines) | `>=22.5` | `node:sqlite` (DatabaseSync) added in 22.5. |
| tsdown target | `node22` | Output optimized for Node 22 runtime. |
| TS target | `es2023` | ECMAScript version matching Node 22 capabilities. |
| TS lib | `es2023` | Type definitions for ES2023 built-in APIs. |

## Code Organization

- `src/broker/` — Redis pub/sub setup (two clients) and `EventEnvelope` type.
- `src/service/bus.ts` — `createPersistentBus`: core logic, prepared statements, publish/subscribe/recall.
- `src/db.ts` — SQLite singleton (cached by path via `Map`), enables WAL mode.
- `src/sql/` — SQL in `.sql` file with `-- name:` annotations, parsed at runtime by `statements.ts`.
- `src/utils/utility.ts` — `sleep`, `calculateRetryDelay` (exponential backoff with jitter), `errorToString`.
- `test/` — Tests use `node:test` (describe/it) and `node:assert/strict`. Common utilities in `test/utils.ts`.

## Naming Conventions and Style Patterns

- **Generics**: `createPersistentBus<PublisherEvents, SubscriberEvents>` for type-safe publish/subscribe.
- **ESM**: `"type": "module"`, imports use `.ts` extensions, `verbatimModuleSyntax`.
- **Envelopes**: `EventEnvelope<N, P>` with `eventName`, `eventId`, `publishedBy`, `publishedAt`, `payload`.
- **Retries**: Exponential backoff with jitter. All `setTimeout` calls use `.unref()`.
- **Graceful Shutdown**: `tryClose` handles `SIGINT`/`SIGTERM`, idempotent via `isClosing` guard.

## Commit Rules

1. **Natural casing**: Commit messages must use natural casing as a human writer would — first letter capitalized, proper nouns and acronyms (SQL, Node.js, TypeScript, etc.) capitalized normally. Never force everything to lowercase.
2. **No attributions**: Never include "Generated with", "Assisted by", harness names, or agent names in commit messages. Commit messages must be clean, professional, and contain only the meaningful description of the change.

## Important Gotchas

1. **Generic Constraints**: `createPersistentBus` requires both type params (`PublisherEvents`, `SubscriberEvents`) — these type-check `publish` and `subscribe` calls.
2. **Prepared Statements**: All SQLite statements compiled once at init — changing SQL requires recompilation.
3. **Timeout Unref**: All `setTimeout` calls use `.unref()` to not block process exit. Don't omit this.
4. **Database Driver**: Uses native `node:sqlite` (`DatabaseSync`), NOT the npm `sqlite3` package.
5. **Node.js >= 22.5**: Required for `node:sqlite`.
6. **DB Singleton**: `createSqliteDb` caches connections by path in a `Map` — same path returns same connection.
7. **SQL Annotation System**: SQL files are loaded as text by tsdown's `loader: { ".sql": "text" }` and parsed via `-- name:` annotations in `statements.ts`.
8. **Retries comparison differs**: `recallOutgoingOutboxes` uses `>= maxRetries` to skip, subscriber catch block uses `> maxRetries` to dead-letter.
9. **publisherName isolation**: All recall/perish queries filter by `publisherName`. Each bus instance in the same SQLite DB only sees events it created.
10. **Configurable options** (with defaults): `maxRetries: 10`, `pendingDelayMs: 10_000`, `recallIntervalMs: 200`.
