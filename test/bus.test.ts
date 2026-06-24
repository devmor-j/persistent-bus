import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createPersistentBus } from "../dist/main.mjs";
import { useTmpDir } from "./utils.ts";

const { REDIS_URL } = process.env;

const { tmpDbPath } = useTmpDir();

describe("createPersistentBus", () => {
  it("returns an object with all expected methods", async () => {
    const bus = await createPersistentBus<
      Record<string, unknown>,
      Record<string, unknown>
    >({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
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

  it("rejects when given an invalid redis URL", async () => {
    await assert.rejects(
      () =>
        createPersistentBus({
          publisherName: "test",
          redisUrl: "redis://nonexistent:9999",
          sqlitePath: tmpDbPath(),
        }),
      /connect|ECONNREFUSED|connection|refused|ENOTFOUND/i,
    );
  });

  it("creates the Outbox table on init", async () => {
    const dbPath = tmpDbPath();
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
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
});

describe("tryClose", () => {
  it("closes both Redis connections", async () => {
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    await bus.tryClose();
    await assert.rejects(
      () => bus.publish(randomUUID(), { after: "close" }),
      /closed|Closed|connection/i,
    );
  });

  it("is idempotent — calling twice does not throw", async () => {
    const bus = await createPersistentBus({
      publisherName: randomUUID(),
      redisUrl: REDIS_URL,
      sqlitePath: tmpDbPath(),
    });
    await bus.tryClose();
    await bus.tryClose();
  });
});
