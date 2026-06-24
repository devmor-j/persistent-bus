import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRetryDelay,
  createDeferred,
  sleep,
  withRetry,
} from "../src/utils/utility.ts";

describe("calculateRetryDelay", () => {
  it("returns a value within expected range", () => {
    const delay = calculateRetryDelay(0);
    assert.ok(delay > 0);
    assert.ok(delay <= 60000 * 1.25);
  });

  it("increases with retry count", () => {
    const d0 = calculateRetryDelay(0, { jitter: 0 });
    const d1 = calculateRetryDelay(1, { jitter: 0 });
    const d2 = calculateRetryDelay(2, { jitter: 0 });
    assert.ok(d1 >= d0);
    assert.ok(d2 >= d1);
  });

  it("caps at maxDelay", () => {
    const delay = calculateRetryDelay(100, { maxDelay: 1000, jitter: 0 });
    assert.ok(delay <= 1000);
  });

  it("uses default jitter when not provided", () => {
    for (let i = 0; i < 10; i++) {
      const delay = calculateRetryDelay(0);
      assert.ok(delay >= 0);
      assert.ok(delay <= 60000 * 1.25);
    }
  });
});

describe("sleep", () => {
  it("resolves after the given duration", async () => {
    const start = Date.now();
    await sleep(50);
    assert.ok(Date.now() - start >= 40);
  });
});

describe("createDeferred", () => {
  it("creates a deferred that can be resolved", async () => {
    const d = createDeferred<number>();
    d.resolve(42);
    assert.equal(await d.promise, 42);
  });

  it("creates a deferred that can be rejected", async () => {
    const d = createDeferred();
    d.reject(new Error("fail"));
    await assert.rejects(() => d.promise, /fail/);
  });
});

describe("withRetry", () => {
  it("resolves on first attempt if fn succeeds", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), {
      retries: 3,
    });
    assert.equal(result, "ok");
  });

  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error("not yet"));
        return Promise.resolve("finally");
      },
      { retries: 5, maxDelay: 10 },
    );
    assert.equal(result, "finally");
    assert.equal(attempts, 3);
  });

  it("rejects after all retries exhausted", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            return Promise.reject(new Error("persistent"));
          },
          { retries: 3, maxDelay: 10 },
        ),
      /persistent/,
    );
    assert.equal(attempts, 3);
  });
});
