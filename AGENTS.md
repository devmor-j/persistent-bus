# persistent-bus Agent Instructions

## Commands

```bash
npm run dev          # Run sample (requires .env file)
npm run build        # Build to dist/
npm run prisma:generate # Generate Prisma client (schema.prisma -> src/prisma/generated/)
npm run prettier     # Format with prettier + organize-imports
```

## Setup

1. Copy `.env.template` to `.env`, fill in `REDIS_URL` and `SQLITE_PATH`
2. Start Redis: `docker compose up redis`
3. Build: `npm run build`
4. Run sample: `npm run dev`

## Architecture

- **Entry**: `src/main.ts` exports `createPersistentBus` and `EventEnvelope` type
- **Broker** (`src/broker/`): Redis pub/sub via `redis` package + Prisma outbox (SQLite)
   - Events stored in SQLite before publishing to Redis (outbox pattern for at-least-once delivery)
- **Service** (`src/service/bus.ts`): `createPersistentBus()` returns `{ publish, subscribe, recallOutbox }`
  - Outbox statuses: `PENDING -> PROCESSING -> COMPLETED | DEAD`
  - Retries: exponential backoff up to 60s; after 10 failures event becomes dead
- **Utils** (`src/utils/utility.ts`): sleep, calculateRetryDelay, withRetry, errorToString

## Conventions

- Strict TypeScript (`verbatimModuleSyntax`, `noUnusedLocals`)
- ESM-only output (tsdown dual-format: esm + cjs)
- Prisma schemas: `schema.prisma` under `src/prisma/` — generate with `npm run prisma:generate`
- Imports use `.ts`/`.js` extensions (enabled via `allowImportingTsExtensions` in tsconfig)
- `.env` files are gitignored except `.env.template`
- Dist is published; other build artifacts ignored

## Testing

Currently the sample at `test/sample.ts` is both documentation and manual test. No automated test framework is configured. To add tests, set up an appropriate test runner alongside Redis in the test environment.