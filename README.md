# 🚌 persistent-bus

<!-- rumdl-disable MD033 -->
<p align="center">
  <img src="https://raw.githubusercontent.com/devmor-j/persistent-bus/main/logo.webp" alt="logo" width="384">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/persistent-bus">
    <img src="https://img.shields.io/npm/v/persistent-bus?color=brightgreen" alt="version">
  </a>
  <img src="https://img.shields.io/npm/dw/persistent-bus" alt="downloads">
  <img src="https://img.shields.io/github/stars/devmor-j/persistent-bus" alt="stars">
  <img src="coverage.svg" alt="coverage">
</p>

Persistent Redis Pub/Sub with at-least-once delivery. A typed, resilient
event bus for Node.js that stores events in SQLite before publishing to Redis,
guaranteeing no messages are lost during broker restarts or crashes.

- 📦 Zero dependencies (uses native `node:sqlite`)
- 🔁 At-least-once delivery with automatic retries and dead lettering
- 🧪 Fully typed with high test coverage
- 📄 Dual ESM / CJS with bundled type declarations

---

## ✨ Features

- **At-Least-Once Delivery** — Events survive on disk before reaching Redis.
  SQLite persistence means a broker restart never drops a message.
- **Automatic Retries** — Failed handlers are retried with exponential backoff
  (up to 60s). Retries continue until the handler succeeds or the retry limit
  is hit.
- **Dead Lettering** — After 10 failed attempts, events are marked `DEAD` to
  prevent infinite retry loops. Dead events can be inspected or purged.
- **Recall Mechanism** — Programmatic retry for all ongoing or dead events.
  Call `recallOutgoingOutboxes()`, `recallDeadOutboxes()`, or
  `perishDeadOutboxes()` on startup or a schedule.
- **Type Safety** — Full TypeScript generics wire event names, payloads, and
  envelopes together so mismatches are caught at compile time.
- **Publisher Isolation** — Each `publisherName` operates on its own scope.
  Recall and dead-letter operations never touch another publisher's events.
- **Graceful Shutdown** — `tryClose()` cleanly drains both Redis connections.
  Registered on SIGINT/SIGTERM automatically — no manual cleanup needed.

---

## 📋 Requirements

- **Node.js** ≥ 22.5
- **Redis** — persistent-bus relies on Redis pub/sub for delivery; publish
  and subscribe are Redis primitives the library does not reinvent.

---

## 📦 Installation

```sh
npm i persistent-bus
```

The library ships as both ESM (`.mjs`) and CommonJS (`.cjs`) with bundled
type declarations. It works with `import` and `require()`.

---

## 🚀 Quick start

### TypeScript

```ts
import { createPersistentBus } from "persistent-bus";

// Define your event contracts at the type level.
type PublisherEvents = {
  "user.created": { id: string; email: string };
};

type SubscriberEvents = {
  "user.created": { id: string; email: string };
  "order.placed": { orderId: string; amount: number };
};

const bus = await createPersistentBus<PublisherEvents, SubscriberEvents>({
  publisherName: "order-service",
  redisUrl: "redis://localhost:6379/9",
  sqlitePath: "./bus.db",
});

// Always register subscribers first, so they're ready to receive.
bus.subscribe("user.created", async (envelope) => {
  const { id, email } = envelope.payload;
  console.log(`Welcome ${id} at ${email}`);
});

// Then publish.
const payload = { id: "abc", email: "a@b.com" };
await bus.publish("user.created", payload);
```

> **Tip:** The library registers SIGINT/SIGTERM handlers automatically, so
> connections are cleaned up on shutdown without calling `tryClose()`.

### JavaScript (ESM)

```js
import { createPersistentBus } from "persistent-bus";
// const { createPersistentBus } = require("persistent-bus");

const bus = await createPersistentBus({
  publisherName: "notification-svc",
  redisUrl: "redis://localhost:6379/9",
  sqlitePath: "./bus.db",
});

bus.subscribe("user.created", async (envelope) => {
  const { id, email } = envelope.payload;
  console.log(`Notification for ${id}: ${email}`);
});

const payload = { id: "xyz", email: "hello@example.com" };
await bus.publish("user.created", payload);
```

### Handling failures

```ts
import { createPersistentBus } from "persistent-bus";

const bus = await createPersistentBus({
  publisherName: "order-service",
  redisUrl: "redis://localhost:6379/9",
  sqlitePath: "./bus.db",
});

bus.subscribe("order.placed", async (envelope) => {
  // If this throws, the event stays PROCESSING and gets retried.
  // After 10 failed attempts it's marked DEAD.
  throw new Error("Database connection failed");
});

// Retry all ongoing (not COMPLETED/DEAD) events for this publisher.
await bus.recallOutgoingOutboxes();

// Re-publish all DEAD events (sorted by updatedAt, 200ms apart).
await bus.recallDeadOutboxes();

// Delete DEAD events older than 7 days (default). Pass 0 to delete all.
await bus.perishDeadOutboxes();
```

---

## 📖 API

### `createPersistentBus<PublisherEvents, SubscriberEvents>(options)`

Creates a bus instance. Two type parameters let you optionally constrain
published and subscribed events differently.

| Option | Type | Default | Description |
|---|---|---|---|
| `publisherName` | `string` | — | Logical name scoping this publisher's events |
| `redisUrl` | `string` | — | Redis connection URL |
| `sqlitePath` | `string` | — | Path to the SQLite database file |
| `maxRetries` | `number` | `10` | Max retry attempts before marking an event `DEAD` |
| `pendingDelayMs` | `number` | `10_000` | Delay in ms before first pending-retry check |
| `recallIntervalMs` | `number` | `200` | Delay in ms between individual recall publishes |

Returns a bus instance with the following methods:

### `bus.publish(eventName, payload)`

Stores the event in SQLite and publishes it to Redis immediately. A one-shot
background timer fires after `pendingDelayMs` (default 10s) and re-publishes if
the event is still `PENDING` (nobody consumed it yet). Subsequent retries use
exponential backoff via `retryIfPending`. If Redis is down, the event stays on
disk and can be published later via `recallOutgoingOutboxes()`.

### `bus.subscribe(eventName, handler)`

Registers a handler for an event. The handler receives an `EventEnvelope`:

```text
{
  eventName: string
  eventId: string
  publishedBy: string
  publishedAt: string   // ISO 8601
  payload: P
}
```

The handler can be sync or async and does not need to return a value.
No thrown error means the event is marked `COMPLETED`.

If the handler throws (or returns a rejected promise), the event is **not**
marked `COMPLETED`. Instead, it is retried with exponential backoff up to
10 times, then marked `DEAD`.

> **Note:** Timers, `setTimeout`, or other async shenanigans inside your
> handler are outside the library's control. If a timer callback fails,
> the library cannot detect it and the event may never be marked `COMPLETED`.

### `bus.recallOutgoingOutboxes()`

Iterates over all ongoing (not `COMPLETED` or `DEAD`) events for this publisher
and re-publishes them to Redis. Skips events that already hit the retry limit.
Useful to call on startup or on a cron schedule.

### `bus.recallDeadOutboxes()`

Finds all events with `status = 'DEAD'` for this publisher and re-publishes
them to Redis (sorted by `updatedAt`, 200ms apart). Useful to retry after
fixing the cause of failure.

### `bus.perishDeadOutboxes(maxAgeDays?)`

Deletes DEAD events older than `maxAgeDays` from SQLite. Defaults to 7 days.
Pass `0` to delete all DEAD events immediately regardless of age.

### `bus.tryClose()`

Closes both Redis connections (publisher and subscriber). Idempotent — safe
to call multiple times. Registered on SIGINT/SIGTERM automatically.

---

## 🗄️ Persistence

Every event is stored in a SQLite database file specified by `sqlitePath`.
All outbox rows — pending, processing, completed, and dead — live in this
file. **If the file is removed, all event history is lost.** Treat it as
part of your data backup strategy.

---

## 🔄 Event Lifecycle

```text
Publish → PENDING ──→ PROCESSING ──→ COMPLETED
                       │
                       └── (retry × 10) ──→ DEAD ──→ (deleted via perish)
```

Every event follows this state machine. Retries use exponential backoff with
jitter, capped at 60 seconds.

---

## 🔗 Links

- [GitHub](https://github.com/devmor-j/persistent-bus)
- [Issues](https://github.com/devmor-j/persistent-bus/issues)

---

## 📄 License

MIT — © Morteza Jamshidi
