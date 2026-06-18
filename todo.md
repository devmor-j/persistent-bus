# TODOs

- [ ] Decouple database and Redis instance creation from `persistent-bus` — accept instances via constructor parameters or configuration instead of creating them internally (currently created internally for development convenience)
  - [ ] Update `createPersistentBus()` signature to accept optional `prisma` and `redis` parameters
  - [ ] Remove `@prisma/client` and `ioredis` as direct dependencies from `package.json`
  - [ ] Verify all existing tests continue passing
  - [ ] Add documentation for the new decoupling approach
