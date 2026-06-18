# Boss - Persistent Redis Pub/Sub with At-Least-Once Delivery

A typed, resilient event bus library for Node.js using Redis pub/sub and PostgreSQL outbox pattern.

## Features

- **At-Least-Once Delivery**: Events are persisted to PostgreSQL before being published to Redis, ensuring no messages are lost
- **Automatic Retries**: Failed event handlers are automatically retried with exponential backoff (up to 60s delay)
- **Dead Letter Handling**: After 10 failed retries, events are marked as "dead" to prevent infinite retry loops
- **Type Safety**: Full TypeScript support with typed event payloads and envelopes
- **Outbox Pattern**: All publishes are idempotent and can be recalled if needed
- **Graceful Shutdown**: Proper cleanup on SIGINT/SIGTERM signals

## License

MIT — © Morteza Jamshidi
