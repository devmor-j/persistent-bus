# AGENTS.md

This file documents essential information for agents working in this codebase to help them work effectively and avoid trial-and-error discovery.

## Project Overview

This is a Node.js library called `persistent-bus` that implements a typed, resilient event bus with at-least-once delivery semantics. It ensures no messages are lost during broker restarts or crashes by storing events in SQLite before publishing to Redis.

## Key Components

- **Broker**: Handles Redis pub/sub operations
- **Prisma**: Manages SQLite persistence using Prisma ORM
- **Service**: Implements the core persistent bus logic
- **Utils**: Contains utility functions for retries, delays, and error handling

## Architecture and Control Flow

1. Events are published to the bus with `publish()` function
2. Events are first stored in SQLite via Prisma (outbox)
3. Events are then published to Redis pub/sub
4. When subscribers receive messages, they process them and update SQLite status
5. Failed messages are retried with exponential backoff
6. After 10 failed retries, messages are marked as "dead" to prevent infinite retry loops

## Essential Commands

- `npm run build` - Compile the project
- `npm run dev` - Run development test
- `npm run prisma:generate` - Generate Prisma client code
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Start Prisma studio for DB visualization
- `npm run prettier` - Format code with Prettier

## Code Organization

- `src/` - Source code
  - `main.ts` - Entry point with exports
  - `broker/` - Redis pub/sub operations
  - `prisma/` - Database interaction layer
  - `service/` - Core bus logic
  - `utils/` - Utility functions
- `test/` - Test files (sample.ts for example usage)

## Naming Conventions and Style Patterns

- TypeScript with strong typing
- Event envelopes carry metadata (event name, ID, publisher, timestamp)
- Retry logic with exponential backoff (up to 60s delay)
- Dead letter handling after 10 retries
- Idempotent publishing - messages can be recalled or redelivered
- Graceful shutdown handling with SIGINT/SIGTERM signals

## Testing Approach

- Uses a sample test file (`test/sample.ts`) demonstrating usage
- Tests basic publish/subscribe functionality
- Tests event persistence and delivery semantics
- Tests error handling and retry mechanisms

## Important Gotchas

1. The `createPersistentBus` function is generic and requires type parameters for publisher and subscriber events
2. Event handling uses `setTimeout` for retry delays, which is a Node.js pattern
3. Messages are stored in SQLite before Redis publishing to ensure persistence
4. Retry logic includes both automatic retries and dead letter handling
5. The `tryClose` function handles graceful shutdowns for Redis connections
6. `prisma` database operations are used for event state management
7. `process.on('SIGINT', tryClose)` and `process.on('SIGTERM', tryClose)` handle graceful shutdowns
8. The `RECALL_SLEEP` constant controls delay between recall attempts
9. The `PENDING_DELAY` constant controls initial delay for pending events
10. Event envelopes are JSON serialized/dserialized for transport
11. The `DEAD_RETRY` constant defines the maximum retry attempts before marking as dead
