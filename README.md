# persistent-bus

<p align="center">
  <img src="coverage.svg" alt="coverage">
</p>

Persistent Redis Pub/Sub with at-least-once delivery. A typed, resilient
event bus library for Node.js that stores events in SQLite before publishing to Redis, ensuring no messages are lost even on broker restarts. This library is zero-dependency (using the native Node.js sqlite module).

## Features

- **At-Least-Once Delivery**: No messages are lost during broker restarts or crashes — events survive on disk before delivery
- **Automatic Retries**: Failed event handlers are automatically retried with exponential backoff (up to 60s delay)
- **Dead Letter Handling**: After 10 failed retries, events are marked as "dead" to prevent infinite retry loops
- **Type Safety**: Full TypeScript support with typed event payloads and envelopes
- **Idempotent Publishing**: Every message is stored in an "outbox" (local queue) before delivery, so repeated publishes don't create duplicates — messages can also be recalled or redelivered programmatically at runtime
- **Graceful Shutdown**: Proper cleanup on SIGINT/SIGTERM signals

## License

MIT — © Morteza Jamshidi
