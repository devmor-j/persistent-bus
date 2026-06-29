import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import {
  createRedisClient,
  DEAD_RETRY,
  randomEventName,
  useTmpDir,
} from "./utils.ts";

const { tmpDbPath } = useTmpDir();

describe("recallOutgoingOutboxes", () => {
  it("re-publishes pending events and increments retries", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "recall-test",
      pubsub,
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
    const pubsub2 = await createRedisClient();
    const bus2 = createPersistentBus({
      publisherName: randomUUID(),
      pubsub: pubsub2,
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
    await pubsub2.tryClose();
  });

  it("skips events already at retry limit", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "recall-skip-test",
      pubsub,
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
  it("re-publishes DEAD events to subscribers", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "dead-recall",
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { retry: true });
    await new Promise((r) => setTimeout(r, 100));

    // Set status to DEAD directly so recallDeadOutboxes picks it up
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD' WHERE eventName = '${eventName}'`,
    );
    db.close();

    // Subscribe on second bus to catch the re-publish
    const pubsub2 = await createRedisClient();
    const bus2 = createPersistentBus({
      publisherName: randomUUID(),
      pubsub: pubsub2,
      sqlitePath: tmpDbPath(),
    });
    const received: unknown[] = [];
    bus2.subscribe(eventName, async (env) => received.push(env));
    await new Promise((r) => setTimeout(r, 200));

    await bus.recallDeadOutboxes();
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(received.length, 1);

    await bus.tryClose();
    await bus2.tryClose();
    await pubsub2.tryClose();
  });

  it("does not affect non-DEAD events", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
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
    // Event is PENDING (not DEAD) so recallDeadOutboxes skips it
    assert.equal(row.status, "PENDING");

    await bus.tryClose();
  });

  it("only processes own publisher's events", async () => {
    const pubsubA = await createRedisClient();
    const pubsubB = await createRedisClient();
    const dbPathA = tmpDbPath();
    const dbPathB = tmpDbPath();
    const busA = createPersistentBus({
      publisherName: "dead-recall-iso-A",
      pubsub: pubsubA,
      sqlitePath: dbPathA,
    });
    const busB = createPersistentBus({
      publisherName: "dead-recall-iso-B",
      pubsub: pubsubB,
      sqlitePath: dbPathB,
    });
    const evtA = randomEventName();

    await busA.publish(evtA, { owned: "A" });
    await new Promise((r) => setTimeout(r, 100));

    // Set busA's event to DEAD
    const db = new DatabaseSync(dbPathA);
    db.exec(`UPDATE Outbox SET status = 'DEAD' WHERE eventName = '${evtA}'`);
    db.close();

    // Listener bus catches any re-publish
    const listenerPubSub = await createRedisClient();
    const listener = createPersistentBus({
      publisherName: randomUUID(),
      pubsub: listenerPubSub,
      sqlitePath: tmpDbPath(),
    });
    const received: unknown[] = [];
    listener.subscribe(evtA, async (env) => received.push(env));
    await new Promise((r) => setTimeout(r, 200));

    // busB calls recall — should NOT publish busA's event
    await busB.recallDeadOutboxes();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(received.length, 0);

    // busA calls recall — publishes its own DEAD event
    await busA.recallDeadOutboxes();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(received.length, 1);

    await busA.tryClose();
    await busB.tryClose();
    await listener.tryClose();
    await pubsubA.tryClose();
    await pubsubB.tryClose();
    await listenerPubSub.tryClose();
  });
});

describe("perishDeadOutboxes", () => {
  it("deletes DEAD events older than maxAgeDays", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: "perish-test",
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { perish: true });
    await new Promise((r) => setTimeout(r, 100));

    // Set status to DEAD with an old updatedAt
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD', updatedAt = '2020-01-01T00:00:00.000Z' WHERE eventName = '${eventName}'`,
    );
    db.close();

    bus.perishDeadOutboxes(1); // delete DEAD events older than 1 day

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db2.close();
    assert.equal(row.cnt, 0);

    await bus.tryClose();
  });

  it("does not delete recent DEAD events", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { keep: true });
    await new Promise((r) => setTimeout(r, 100));

    // Set status to DEAD with current timestamp
    const now = new Date().toISOString();
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD', updatedAt = '${now}' WHERE eventName = '${eventName}'`,
    );
    db.close();

    bus.perishDeadOutboxes(7); // delete DEAD events older than 7 days

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db2.close();
    assert.equal(row.status, "DEAD"); // still there, too recent

    await bus.tryClose();
  });

  it("pass 0 to delete all DEAD events regardless of age", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { purge: true });
    await new Promise((r) => setTimeout(r, 100));

    // Set status to DEAD
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD' WHERE eventName = '${eventName}'`,
    );
    db.close();

    bus.perishDeadOutboxes(0); // delete all DEAD events

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db2.close();
    assert.equal(row.cnt, 0);

    await bus.tryClose();
  });

  it("works with default maxAgeDays argument", async () => {
    const pubsub = await createRedisClient();
    const dbPath = tmpDbPath();
    const bus = createPersistentBus({
      publisherName: randomUUID(),
      pubsub,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { x: 1 });
    await new Promise((r) => setTimeout(r, 100));

    // Set to DEAD with very old timestamp
    const db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE Outbox SET status = 'DEAD', updatedAt = '2019-01-01T00:00:00.000Z' WHERE eventName = '${eventName}'`,
    );
    db.close();

    bus.perishDeadOutboxes(); // default maxAgeDays = 7

    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare("SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, number>;
    db2.close();
    assert.equal(row.cnt, 0);

    await bus.tryClose();
  });
});
