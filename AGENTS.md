# AGENTS.md

This file documents essential information for agents working in this codebase to help them work effectively and avoid trial-and-error discovery.

## Project Overview

This is a Node.js library called `persistent-bus` that implements a typed, resilient event bus with at-least-once delivery semantics. It ensures no messages are lost during broker restarts or crashes by storing events in SQLite before publishing to Redis.

## Key Components

- **Broker**: Handles Redis pub/sub operations using the `redis` library.
- **SQLite**: Manages persistence using the native Node.js `sqlite3` driver.
- **Service**: Implements the core persistent bus logic (outbox pattern).
- **Utils**: Contains utility functions for retries, delays, and error handling.

## Architecture and Control Flow

1. **Publishing**:
   - Events are first stored in SQLite via the `createOutbox` function (the "Outbox").
   - Events are then published to Redis pub/sub.
   - If the initial publication fails, a `setTimeout` with exponential backoff is scheduled to retry the publication.
2. **Subscribing**:
   - Subscribers receive messages from Redis and are immediately marked as `PROCESSING` in SQLite.
   - Upon successful processing, they are marked `COMPLETED`.
   - On failure, the system calculates a retry delay and schedules a re-publication to Redis.
3. **Recall Mechanism**:
   - `recallOutgoingOutboxes` — retries publishing for all ongoing outboxes not yet at the retry limit.
   - `recallDeadOutboxes` — marks outboxes that have hit the retry limit as `DEAD`.
   - `perishDeadOutboxes` — permanently deletes outboxes that have hit the retry limit from SQLite.
   - These three functions can be called programmatically at any time (e.g., on startup or on a cron schedule).
4. **Dead Lettering**:
   - Messages that exceed `DEAD_RETRY` (10) attempts are marked as `DEAD` to prevent infinite retry loops.
   - `recallDeadOutboxes` and `perishDeadOutboxes` are the two ways to handle dead events: mark them for inspection or purge them entirely.

## Essential Commands

- `npm run build` - Compile the project using `tsdown`.
- `npm run dev` - Run the development test suite (`sample.ts`).
- `npm run prettier` - Format code using Prettier with `organize-imports` plugin.

## Version Targets

| Config | Value | Rationale |
|---|---|---|
| Node.js (engines) | `>=22.5` | `node:sqlite` (DatabaseSync) added in 22.5. |
| tsdown target | `node22` | Output optimized for Node 22 runtime. |
| TS target | `es2023` | ECMAScript version matching Node 22 capabilities. |
| TS lib | `es2023` | Type definitions for ES2023 built-in APIs. |

## Code Organization

- `src/` - Source code
  - `main.ts` - Entry point with exports.
  - `broker/` - Redis pub/sub and `EventEnvelope` definitions.
  - `service/` - Core persistent bus logic, including SQLite prepared statements.
  - `utils/` - Utility functions (retries, sleep, etc.).
- `test/` - Test files (sample.ts for example usage).

## Naming Conventions and Style Patterns

- **TypeScript**: Strong typing with generics for publisher and subscriber events.
- **ESM**: The project uses Node.js ECMAScript Modules (`"type": "module"`).
- **Event Envelopes**: All events carry metadata: `eventName`, `eventId`, `publishedBy`, `publishedAt`, and `payload`.
- **Retry Logic**: Uses exponential backoff with `setTimeout(...).unref()` to avoid blocking process exit.
- **Graceful Shutdown**: Handles `SIGINT` and `SIGTERM` via `tryClose` to ensure Redis connections are closed cleanly.

## Testing Approach

- Uses `test/sample.ts` as a reference for integration testing.
- Focuses on verifying:
  - Basic publish/subscribe flow.
  - Persistence of events in SQLite.
  - Retry mechanisms and dead letter handling.

## Commit Rules

1. **Natural casing**: Commit messages must use natural casing as a human writer would — first letter capitalized, proper nouns and acronyms (SQL, Node.js, TypeScript, etc.) capitalized normally. Never force everything to lowercase.
2. **No attributions**: Never include "Generated with", "Assisted by", harness names, or agent names in commit messages. Commit messages must be clean, professional, and contain only the meaningful description of the change.

## Important Gotchas

1. **Generic Constraints**: `createPersistentBus` requires type parameters for `PublisherEvents` and `SubscriberEvents` to ensure type safety across the bus.
2. **Prepared Statements**: SQLite statements are compiled once during `createPersistentBus` initialization for performance.
3. **Timeout Unref**: Use `.unref()` on all `setTimeout` calls to prevent the Node.js event loop from staying active indefinitely.
4. **Database Driver**: Uses the native `sqlite3` driver; ensure the SQLite library is available in the environment.
5. **Node.js Version**: Requires Node.js >= 22.5.
6. **Concurrency**: SQLite is used for state tracking; be mindful of write contention if high concurrency is expected.
7. **Constants**:
   - `DEAD_RETRY`: 10 attempts.
   - `PENDING_DELAY`: Initial delay before first retry.
   - `RECALL_SLEEP`: Delay between sequential recall attempts.
