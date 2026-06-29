import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRetryDelay, sleep } from "../src/utils/utility.ts";

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

  it("resolves immediately with duration 0", async () => {
    const start = Date.now();
    await sleep(0);
    assert.ok(Date.now() - start < 50);
  });

  it("resolves with the duration value", async () => {
    const result = await sleep(10);
    assert.equal(result, 10);
  });
});
