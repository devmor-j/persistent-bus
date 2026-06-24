import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { randomEventName, useTmpDir } from "./utils.ts";

const { REDIS_URL } = process.env;

const { tmpDbPath } = useTmpDir();

describe("event envelope", () => {
  it("produces correct envelope fields", async () => {
    const bus = await createPersistentBus<
      Record<string, unknown>,
      Record<string, unknown>
    >({
      publisherName: "envelope-test",
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    const eventName = randomEventName();
    const payload = { message: "hello" };

    const received: unknown[] = [];
    bus.subscribe(eventName, async (env) => {
      received.push(env);
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, payload);
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(received.length, 1);
    const env = received[0] as Record<string, unknown>;
    assert.equal(env.eventName, eventName);
    assert.equal(typeof env.eventId, "string");
    assert.equal(env.publishedBy, "envelope-test");
    assert.equal(typeof env.publishedAt, "string");
    assert.deepStrictEqual(env.payload, payload);
    assert.match(
      env.eventId as string,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.doesNotThrow(() => new Date(env.publishedAt as string));

    await bus.tryClose();
  });
});

describe("publish and subscribe", () => {
  it("happy path: subscriber receives published event", async () => {
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    const eventName = randomEventName();
    const received: unknown[] = [];

    bus.subscribe(eventName, async (env) => {
      received.push(env);
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { value: 42 });
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(received.length, 1);
    assert.deepStrictEqual((received[0] as Record<string, unknown>).payload, {
      value: 42,
    });

    await bus.tryClose();
  });

  it("delivers multiple event types correctly", async () => {
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    const evtA = randomEventName();
    const evtB = randomEventName();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    bus.subscribe(evtA, async (env) => receivedA.push(env.payload));
    bus.subscribe(evtB, async (env) => receivedB.push(env.payload));

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(evtA, { letter: "A" });
    await bus.publish(evtB, { letter: "B" });
    await bus.publish(evtA, { letter: "C" });
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(receivedA.length, 2);
    assert.equal(receivedB.length, 1);
    assert.deepStrictEqual(receivedA[0], { letter: "A" });
    assert.deepStrictEqual(receivedA[1], { letter: "C" });
    assert.deepStrictEqual(receivedB[0], { letter: "B" });

    await bus.tryClose();
  });
});

describe("subscriber handler success", () => {
  it("marks event COMPLETED after successful handler", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();
    let handlerPayload: unknown = null;

    bus.subscribe(eventName, async (env) => {
      handlerPayload = env.payload;
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { data: "test" });
    await new Promise((r) => setTimeout(r, 300));

    assert.deepStrictEqual(handlerPayload, { data: "test" });

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db.close();
    assert.equal(row.status, "COMPLETED");

    await bus.tryClose();
  });
});

describe("status transition lifecycle", () => {
  it("follows PENDING → PROCESSING → COMPLETED on success", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();
    let statusDuringHandler: string | null = null;

    bus.subscribe(eventName, async () => {
      const db = new DatabaseSync(dbPath);
      const row = db
        .prepare("SELECT status FROM Outbox WHERE eventName = ?")
        .get(eventName) as Record<string, string>;
      db.close();
      statusDuringHandler = row.status;
    });

    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { lifecycle: true });
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(statusDuringHandler, "PROCESSING");

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db.close();
    assert.equal(row.status, "COMPLETED");

    await bus.tryClose();
  });
});

describe("publisher isolation", () => {
  it("recallOutgoingOutboxes only operates on own publisher's events", async () => {
    const dbPathA = tmpDbPath();
    const dbPathB = tmpDbPath();
    const busA = await createPersistentBus({
      publisherName: "pub-isolation-A",
      redisUrl: REDIS_URL,
      sqlitePath: dbPathA,
    });
    const busB = await createPersistentBus({
      publisherName: "pub-isolation-B",
      redisUrl: REDIS_URL,
      sqlitePath: dbPathB,
    });
    const evtA = randomEventName();
    const evtB = randomEventName();

    await busA.publish(evtA, { owner: "A" });
    await busB.publish(evtB, { owner: "B" });
    await new Promise((r) => setTimeout(r, 200));

    await busA.recallOutgoingOutboxes();

    const db = new DatabaseSync(dbPathA);
    const rowA = db
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(evtA) as Record<string, number>;
    db.close();
    const dbB = new DatabaseSync(dbPathB);
    const rowB = dbB
      .prepare("SELECT retries FROM Outbox WHERE eventName = ?")
      .get(evtB) as Record<string, number>;
    dbB.close();

    assert.equal(rowA.retries, 1);
    assert.equal(rowB.retries, 0);

    await busA.tryClose();
    await busB.tryClose();
  });
});

describe("concurrent events", () => {
  it("delivers multiple rapidly-published events", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();
    const received: unknown[] = [];
    const COUNT = 20;

    bus.subscribe(eventName, async (env) => received.push(env.payload));

    await new Promise((r) => setTimeout(r, 200));

    const promises: Promise<void>[] = [];
    for (let i = 0; i < COUNT; i++) {
      promises.push(bus.publish(eventName, { index: i }));
    }
    await Promise.all(promises);
    await new Promise((r) => setTimeout(r, 1000));

    assert.equal(received.length, COUNT);

    const db = new DatabaseSync(dbPath);
    const completed = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM Outbox WHERE eventName = ? AND status = 'COMPLETED'",
      )
      .get(eventName) as Record<string, number>;
    db.close();
    assert.equal(completed.cnt, COUNT);

    await bus.tryClose();
  });
});
