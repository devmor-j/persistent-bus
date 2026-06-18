## Agent Quick Reference

### Development Commands

```bash
# Bundle to dist/
npm run build

# Run Prisma (requires running dev servers via compose)
npx prisma generate        # generate client from schema
npx prisma db push         # apply schema changes
npx prisma migrate create --name desc   # create migration file
npx prisma migrate apply         # run pending migrations

# Start Postgres + Redis locally
docker compose up -d && sleep 5
```

### Environment Variables

Required: `POSTGRES_URL` (PostgreSQL connection string), `REDIS_URL` (Redis connection URL).

### Architecture

Entry point: `src/main.ts` exports `EventEnvelope` type and `createPersistentBus` factory function.

Structure:
- `src/broker/events.ts` — TypeScript types (`EventEnvelope`, `Handler`, `EventPayloadMap`)
- `src/broker/pubsub.ts` — Redis pub/sub wrapper (publish/subscribe via Redis)
- `src/prisma/prisma.ts` — Prisma client connected to PostgreSQL
- `src/service/bus.ts` — **Core**: Persistent pub/sub with outbox retry, dead queues, recall. Main entrypoint: `createPersistentBus()`
- `src/utils/utility.ts` — Shared utilities: `sleep()`, `calculateRetryDelay()`, `withRetry<T>()`, `errorToString()`

Package config: module output to `dist/main.{mjs,cjs}` with dual CJS/ESM + TypeScript declaration exports.

### Code Style & Constraints

- TypeScript strict mode enabled (verbatimModuleSyntax, isolatedModules, noUnusedLocals)
- Output is bundled via tsdown with never-bundle for native node modules
- No test framework in place — new tests should be added when possible
- Logging goes directly to `console.*` via `src/utils/logger.ts`
