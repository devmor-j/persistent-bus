import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { sleep } from "../src/utils/utility.ts";
import {
  createRedisClient,
  DEAD_RETRY,
  randomEventName,
  useTmpDir,
} from "./utils.ts";

const { tmpDbPath } = useTmpDir();

describe("subscriber failure and dead lettering", () => {
  it("marks DEAD when subscriber throws with retries above threshold", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    // Handler sleeps 300ms before throwing, giving us time to bump
    // retries in the DB before the catch block reads them.
    bus.subscribe(eventName, async () => {
      await sleep(300);
      throw new Error("handler failure");
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { dead: true });

    // Wait briefly for markProcessingOutbox, then bump retries
    // above threshold so the catch block takes the dead path.
    await sleep(50);
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET retries = ${DEAD_RETRY + 1} WHERE eventName = '${eventName}'`,
    );
    db.close();

    // Wait for handler sleep + catch block to run
    await sleep(600);

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT status, retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db2.close();
    assert.equal(row.status, "DEAD");

    await bus.tryClose();
  });
});

describe("retry decrement on publish failure", () => {
  it("decrements retry when pubsub.publish throws in recall", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "decrement-test",
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { dec: true });
    await new Promise((r) => setTimeout(r, 200));

    const db = new DatabaseSync(dbPath);
    db.exec(`UPDATE Outbox SET retries = 1 WHERE eventName = '${eventName}'`);
    db.close();

    await bus.tryClose();
    await bus.recallOutgoingOutboxes();

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db2.close();
    // recall: increment to 2 → publish fails → decrement to 1
    assert.equal(row.retries, 1);
  });
});

describe("subscriber retry scheduling", () => {
  it("retries subscriber handler on failure then succeeds on retry", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "retry-sched",
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();
    let callCount = 0;

    bus.subscribe(eventName, async () => {
      callCount++;
      if (callCount < 2) throw new Error("first attempt fails");
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { retry: true });

    // Wait for initial processing + retry scheduling + retry fire
    // With maxRetries=10, retry delay is ~59ms + jitter ≈ 60-75ms
    await sleep(1000);

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT status, retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db.close();
    assert.equal(row.status, "COMPLETED");
    // Should have retried once (initial fail + retry)
    assert.equal(row.retries, 1);
    assert.equal(callCount, 2);

    await bus.tryClose();
  });
});

describe("recallDeadOutboxes publish failure", () => {
  it("handles publish failure gracefully and keeps event DEAD", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "dead-fail",
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    // Create a DEAD event
    await bus.publish(eventName, { die: true });
    await new Promise((r) => setTimeout(r, 200));

    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD', retries = 11 WHERE eventName = '${eventName}'`,
    );
    db.close();

    // Close pubsub so publish fails
    await bus.tryClose();

    // recallDeadOutboxes should not throw when publish fails
    await bus.recallDeadOutboxes();

    // Verify event is still DEAD
    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db2.close();
    assert.equal(row.status, "DEAD");
  });
});
