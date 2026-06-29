import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { sleep } from "../src/utils/utility.ts";
import { createRedisPubSub, randomEventName, useTmpDir } from "./utils.ts";

const { tmpDbPath } = useTmpDir();

describe("createPersistentBus", () => {
  it("returns an object with all expected methods", async () => {
    const pubsub = await createRedisPubSub();
    const bus = createPersistentBus<
      Record<string, unknown>,
      Record<string, unknown>
    >({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: tmpDbPath(),
    });

    assert.equal(typeof bus.publish, "function");
    assert.equal(typeof bus.subscribe, "function");
    assert.equal(typeof bus.recallOutgoingOutboxes, "function");
    assert.equal(typeof bus.recallDeadOutboxes, "function");
    assert.equal(typeof bus.perishDeadOutboxes, "function");
    assert.equal(typeof bus.tryClose, "function");

    await bus.tryClose();
  });

  it("creates the Outbox table on init", async () => {
    const pubsub = await createRedisPubSub();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
    });

    const db = new DatabaseSync(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='Outbox'",
      )
      .all();
    db.close();
    assert.equal(tables.length, 1);

    await bus.tryClose();
  });

  it("retryIfPending re-publishes event still in PENDING state", async () => {
    const pubsub = await createRedisPubSub();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
      pendingDelayMs: 100,
    });
    const eventName = randomEventName();

    // No subscriber — event stays PENDING
    await bus.publish(eventName, { val: true });
    // Wait for initial publish + retryIfPending timeout
    await sleep(400);

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db.close();
    // retryIfPending should have fired and incremented retries
    assert.ok(row.retries >= 1);

    await bus.tryClose();
  });

  it("recall on empty outbox does not throw", async () => {
    const pubsub = await createRedisPubSub();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: tmpDbPath(),
    });

    await assert.doesNotReject(() => bus.recallOutgoingOutboxes());
    await assert.doesNotReject(() => bus.recallDeadOutboxes());

    await bus.tryClose();
  });

  it("retryIfPending marks DEAD when retries exceed maxRetries", async () => {
    const pubsub = await createRedisPubSub();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
      // Long delay so we can bump retries before the callback fires
      pendingDelayMs: 2000,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { die: true });

    // Bump retries above maxRetries before retryIfPending fires
    const db = new DatabaseSync(dbPath);
    db.exec(`UPDATE Outbox SET retries = 11 WHERE eventName = '${eventName}'`);
    db.close();

    // Wait for retryIfPending to fire + process
    await sleep(2500);

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT status, error FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db2.close();
    assert.equal(row.status, "DEAD");
    assert.equal(row.error, "retry:dead");

    await bus.tryClose();
  });
});

describe("tryClose", () => {
  it("closes pubsub connections", async () => {
    const pubsub = await createRedisPubSub();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: tmpDbPath(),
    });
    await bus.tryClose();
    await assert.rejects(
      () => bus.publish(randomUUID(), { after: "close" }),
      /closed|Closed|connection/i,
    );
  });

  it("is idempotent — calling twice does not throw", async () => {
    const pubsub = await createRedisPubSub();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: tmpDbPath(),
    });
    await bus.tryClose();
    await bus.tryClose();
  });
});
