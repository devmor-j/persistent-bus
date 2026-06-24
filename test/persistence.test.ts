import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { randomEventName, useTmpDir } from "./utils.ts";

const { REDIS_URL } = process.env;

const { tmpDbPath } = useTmpDir();

describe("database persistence", () => {
  it("stores row with correct fields after publish", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: "db-test",
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    await bus.publish(eventName, { x: 1, y: 2 });
    await new Promise((r) => setTimeout(r, 200));

    const db = new DatabaseSync(dbPath);
    const rows = db
      .prepare(
        "SELECT * FROM Outbox WHERE publishedBy = ? ORDER BY createdAt DESC LIMIT 1",
      )
      .all("db-test") as Record<string, unknown>[];
    db.close();

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.eventName, eventName);
    assert.equal(row.publishedBy, "db-test");
    assert.equal(row.status, "PENDING");
    assert.equal(row.retries, 0);
    assert.equal(row.error, null);
    assert.equal(typeof row.eventId, "string");
    assert.deepStrictEqual(JSON.parse(row.payload as string), { x: 1, y: 2 });
    const parsedData = JSON.parse(row.data as string);
    assert.equal(parsedData.eventName, eventName);
    assert.deepStrictEqual(parsedData.payload, { x: 1, y: 2 });

    await bus.tryClose();
  });

  it("transitions status: PENDING -> PROCESSING -> COMPLETED", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();

    bus.subscribe(eventName, async () => {});
    await new Promise((r) => setTimeout(r, 200));
    await bus.publish(eventName, { ok: true });
    await new Promise((r) => setTimeout(r, 300));

    const db = new DatabaseSync(dbPath);
    const rows = db
      .prepare("SELECT status FROM Outbox WHERE eventName = ?")
      .all(eventName) as Record<string, string>[];
    db.close();
    assert.equal(rows[0].status, "COMPLETED");

    await bus.tryClose();
  });

  it("stores payload as JSON", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: dbPath,
    });
    const eventName = randomEventName();
    const payload = { nested: { arr: [1, 2, 3] }, flag: true };

    await bus.publish(eventName, payload);
    await new Promise((r) => setTimeout(r, 200));

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT payload FROM Outbox WHERE eventName = ?")
      .get(eventName) as Record<string, string>;
    db.close();
    assert.deepStrictEqual(JSON.parse(row.payload), payload);

    await bus.tryClose();
  });
});
