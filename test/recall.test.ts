import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { DEAD_RETRY, randomEventName, useTmpDir } from "./utils.ts";

const { REDIS_URL } = process.env;

const { tmpDbPath } = useTmpDir();

describe("recallOutgoingOutboxes", () => {
  it("re-publishes pending events and increments retries", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "recall-test",
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { recall: true });
    await new Promise((r) => setTimeout(r, 200));

    let db = new DatabaseSync(dbPath);
    let row = db
      .prepare("SELECT retries, status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db.close();
    assert.equal(row.retries, 0);
    assert.equal(row.status, "PENDING");

    // Subscribe on second bus to catch the re-publish
    const bus2 = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    const received: unknown[] = [];
    bus2.subscribe(eventName, async (env) => received.push(env));
    await new Promise((r) => setTimeout(r, 200));

    await bus.recallOutgoingOutboxes();
    await new Promise((r) => setTimeout(r, 500));

    db = new DatabaseSync(dbPath);
    row = db
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db.close();
    assert.equal(row.retries, 1);
    assert.equal(received.length, 1);

    await bus.tryClose();
    await bus2.tryClose();
  });

  it("skips events already at retry limit", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "recall-skip-test",
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { skip: true });
    await new Promise((r) => setTimeout(r, 100));

    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET retries = ${DEAD_RETRY} WHERE eventName = '${eventName}'`,
    );
    db.close();

    await bus.recallOutgoingOutboxes();

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db2.close();
    assert.equal(row.retries, DEAD_RETRY);

    await bus.tryClose();
  });
});

describe("recallDeadOutboxes", () => {
  it("marks events with retries >= DEAD_RETRY as DEAD", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "dead-recall",
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { dead: true });
    await new Promise((r) => setTimeout(r, 100));

    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET retries = ${DEAD_RETRY} WHERE eventName = '${eventName}'`,
    );
    db.close();

    await bus.recallDeadOutboxes();

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT status, error FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, unknown>;
    db2.close();
    assert.equal(row.status, "DEAD");
    assert.equal(row.error, "recall:dead");

    await bus.tryClose();
  });

  it("does not affect events with retries below DEAD_RETRY", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { low: true });
    await new Promise((r) => setTimeout(r, 100));
    await bus.recallDeadOutboxes();

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db.close();
    assert.notEqual(row.status, "DEAD");

    await bus.tryClose();
  });

  it("only processes own publisher's events", async () => {
    const dbPathA = tmpDbPath();
    const dbPathB = tmpDbPath();
    const busA = await createPersistentBus({
      publisherName: "dead-recall-iso-A",
      redisUrl: REDIS_URL,
      sqlitePath: dbPathA,
    });
    const busB = await createPersistentBus({
      publisherName: "dead-recall-iso-B",
      redisUrl: REDIS_URL,
      sqlitePath: dbPathB,
    });
    const evtA = randomEventName();

    await busA.publish(evtA, { owned: "A" });
    await new Promise((r) => setTimeout(r, 100));

    const db = new DatabaseSync(dbPathA);
    db.exec(
      `UPDATE Outbox SET retries = ${DEAD_RETRY} WHERE eventName = '${evtA}'`,
    );
    db.close();

    await busB.recallDeadOutboxes();

    const db2 = new DatabaseSync(dbPathA);
    const row = db2
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(evtA) as Record<string, unknown>;
    db2.close();
    assert.notEqual(row.status, "DEAD");

    await busA.recallDeadOutboxes();

    const db3 = new DatabaseSync(dbPathA);
    const row2 = db3
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(evtA) as Record<string, unknown>;
    db3.close();
    assert.equal(row2.status, "DEAD");

    await busA.tryClose();
    await busB.tryClose();
  });
});

describe("perishDeadOutboxes", () => {
  it("deletes events with retries >= DEAD_RETRY", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "perish-test",
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { perish: true });
    await new Promise((r) => setTimeout(r, 100));

    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET retries = ${DEAD_RETRY} WHERE eventName = '${eventName}'`,
    );
    db.close();

    bus.perishDeadOutboxes();

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db2.close();
    assert.equal(row.cnt, 0);

    await bus.tryClose();
  });

  it("does not delete events below DEAD_RETRY", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { keep: true });
    await new Promise((r) => setTimeout(r, 100));
    bus.perishDeadOutboxes();

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db.close();
    assert.equal(row.cnt, 1);

    await bus.tryClose();
  });
});
