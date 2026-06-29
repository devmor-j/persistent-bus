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

- 📦 Zero runtime dependencies (uses native `node:sqlite`)
- 🔁 At-least-once delivery with automatic retries and dead lettering
- 🧪 Fully typed with high test coverage
- 📄 Dual ESM / CJS with bundled type declarations

---

## ✨ Features

- **At-Least-Once Delivery** — Events survive on disk before reaching Redis.
  A broker restart never drops a message.
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
- **Graceful Shutdown** — `tryClose()` cleanly drains the pub/sub connections.
  Idempotent — safe to call multiple times.

---

## 📋 Requirements

- **Node.js** ≥ 22.5 (required for `node:sqlite`)
- **Redis** — persistent-bus relies on Redis pub/sub for delivery. You provide
  a connected pub/sub instance — the library doesn't manage the Redis connection.

---

## 📦 Installation

```sh
npm i persistent-bus
```

Ships as ESM (`.mjs`) and CommonJS (`.cjs`) with bundled type declarations.

---

## 🚀 Quick start

```ts
import { createClient } from "redis";
import { createPersistentBus } from "persistent-bus";

// Connect your own Redis clients.
const [publisher, subscriber] = await Promise.all([
  createClient({ url: "redis://localhost:6379" }).connect(),
  createClient({ url: "redis://localhost:6379" }).connect(),
]);

const bus = createPersistentBus<
  { "user.created": { id: string; email: string } },
  { "user.created": { id: string; email: string } }
>({
  publisherName: "order-service",
  pubsub: {
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
    tryClose: async () => {
      await Promise.allSettled([publisher.close(), subscriber.close()]);
    },
  },
  sqlitePath: "./bus.db",
});

// Better to register subscribers before publishing so they're ready to receive.
bus.subscribe("user.created", async (envelope) => {
  console.log(`Welcome ${envelope.payload.id}`);
});

await bus.publish("user.created", { id: "abc", email: "a@b.com" });
await bus.tryClose();
```

> **Note:** Redis client methods lose `this` when destructured — use `.bind()`
> as shown above, or wrap them in arrow functions.

### JavaScript (ESM)

```js
import { createClient } from "redis";
import { createPersistentBus } from "persistent-bus";

const [publisher, subscriber] = await Promise.all([
  createClient({ url: "redis://localhost:6379" }).connect(),
  createClient({ url: "redis://localhost:6379" }).connect(),
]);

const bus = createPersistentBus({
  publisherName: "notification-svc",
  pubsub: {
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
    tryClose: async () => {
      await Promise.allSettled([publisher.close(), subscriber.close()]);
    },
  },
  sqlitePath: "./bus.db",
});

bus.subscribe("user.created", async (envelope) => {
  console.log(`Notification for ${envelope.payload.id}`);
});

await bus.publish("user.created", { id: "xyz", email: "hello@example.com" });
await bus.tryClose();
```

### Handling failures

```ts
const bus = createPersistentBus({
  publisherName: "order-service",
  pubsub: { publish, subscribe, tryClose },
  sqlitePath: "./bus.db",
});

bus.subscribe("order.placed", async (envelope) => {
  // If this throws, the event stays PROCESSING and gets retried.
  // After 10 failed attempts it's marked DEAD.
  throw new Error("Database connection failed");
});

// Retry all ongoing (not COMPLETED/DEAD) events for this publisher.
await bus.recallOutgoingOutboxes();

// Re-publish all DEAD events.
await bus.recallDeadOutboxes();

// Delete DEAD events older than 7 days (default). Pass 0 to delete all.
bus.perishDeadOutboxes();
```

---

## 📖 API

### `createPersistentBus<PublisherEvents, SubscriberEvents>(options)`

Creates a bus instance. Two type parameters let you optionally constrain
published and subscribed events differently.

| Option             | Type     | Default  | Description                                       |
| ------------------ | -------- | -------- | ------------------------------------------------- |
| `publisherName`    | `string` | —        | Logical name scoping this publisher's events      |
| `pubsub`           | `PubSub` | —        | Object with `publish?`, `subscribe?`, `tryClose?` |
| `sqlitePath`       | `string` | —        | Path to the SQLite database file                  |
| `maxRetries`       | `number` | `10`     | Max retry attempts before marking an event `DEAD` |
| `pendingDelayMs`   | `number` | `10_000` | Delay in ms before first pending-retry check      |
| `recallIntervalMs` | `number` | `200`    | Delay in ms between individual recall publishes   |

Returns a bus instance with the following methods:

### `bus.publish(eventName, payload)`

Stores the event in SQLite and publishes it to Redis immediately. A one-shot
background timer fires after `pendingDelayMs` (default 10s) and re-publishes if
the event is still `PENDING`. Subsequent retries use exponential backoff.
If Redis is down, the event stays on disk and can be published later via
`recallOutgoingOutboxes()`.

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

The handler can be sync or async. Completion marks the event `COMPLETED`.
If the handler throws, the event is retried with exponential backoff up to
10 times, then marked `DEAD`.

> **Note:** Timers or other async shenanigans inside your handler are outside
> the library's control. If a timer callback fails, the library cannot detect it.

### `bus.recallOutgoingOutboxes()`

Iterates all ongoing (not `COMPLETED` or `DEAD`) events for this publisher
and re-publishes them to Redis. Skips events at the retry limit.
Useful on startup or on a cron schedule.

### `bus.recallDeadOutboxes()`

Re-publishes all `DEAD` events for this publisher (sorted by `updatedAt`).
Does not change their status or retry count. Useful to retry after fixing
the cause of failure.

### `bus.perishDeadOutboxes(maxAgeDays?)`

Deletes `DEAD` events older than `maxAgeDays` from SQLite. Defaults to 7 days.
Pass `0` to delete all `DEAD` events immediately.

### `bus.tryClose()`

Closes the underlying pub/sub connections. Idempotent — safe to call multiple
times. Call this during your application's shutdown sequence.

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

## ⚖️ How does it compare?

**Redis pub/sub** drops messages on restart. **Redis Streams** fixes that but adds
consumer groups, pending-entry lists, and a dozen other primitives you don't need
for simple event broadcasting.

`persistent-bus` is the middle ground: Redis pub/sub with **just enough** reliability
via a lightweight SQLite outbox. No stream configs, no extra daemons.

| Feature               | 🚌 persistent-bus                            | 📦 Redis Streams             | 🐇 RabbitMQ             | 🚀 Kafka          |
| --------------------- | -------------------------------------------- | ---------------------------- | ----------------------- | ----------------- |
| **Crash-proof**       | ✅ SQLite outbox — saved _before_ Redis      | ⚠️ AOF/RDB — can lose writes | ✅ Durable queues       | ✅ Replicated log |
| **TypeScript safety** | ✅ Generics — compile-time checked           | ❌                           | ❌                      | ❌                |
| **DLQ + auto retry**  | ✅ Built-in with backoff                     | ❌ Manual                    | ✅ DLX + TTL            | ❌ Manual         |
| **Recall API**        | ✅ Re-publish all uncompleted or dead events | ❌ Manual replay             | ❌ Manual               | ❌ Offset reset   |
| **Complex routing**   | ❌ Simple pub/sub                            | ❌                           | ✅ Topic/fanout/headers | ❌ Topic-only     |
| **Ordering**          | ❌                                           | ✅ Per stream                | ✅ Per queue            | ✅ Per partition  |
| **Throughput**        | ~30k msg/s                                   | ~200K msg/s                  | ~30K msg/s              | Millions/sec      |

### When to pick persistent-bus

- **You run Redis** but need crash-proof delivery — pub/sub loses messages on restart.
- **Zero ops overhead** — no ZooKeeper, Erlang, or separate broker.
- **Type safety matters** — mismatched event contracts are a compiler error.
- **You need recall** — re-publish everything that isn't done with one call.

### When to look elsewhere

| You need...                               | Pick this            |
| ----------------------------------------- | -------------------- |
| Complex routing (topic exchanges, fanout) | **RabbitMQ**         |
| Millions of events/sec, event sourcing    | **Kafka**            |
| Exactly-once FIFO, managed infra          | **SQS**              |
| Delayed/cron jobs, job queues             | **BullMQ**           |
| Sub-ms latency at edge scale              | **NATS + JetStream** |
| Built-in consumer groups                  | **Redis Streams**    |

---

## 📄 License

MIT — © Morteza Jamshidi
