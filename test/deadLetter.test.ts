import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { sleep } from "../src/utils/utility.ts";
import { DEAD_RETRY, randomEventName, useTmpDir } from "./utils.ts";

const { REDIS_URL } = process.env;

const { tmpDbPath } = useTmpDir();

describe("subscriber failure and dead lettering", () => {
  it("marks DEAD when subscriber throws with retries above threshold", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
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
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "decrement-test",
      redisUrl: REDIS_URL,
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
