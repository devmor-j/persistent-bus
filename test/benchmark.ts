import "@dotenvx/dotenvx/config";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createPersistentBus } from "../dist/main.mjs";
import { createRedisPubSub } from "./utils.ts";

const { REDIS_URL } = process.env;
const BATCH_SIZES = [1000, 5000, 25000];
const WARMUP = 50;

type BenchEvents = {
  bench: { seq: number; ts: string };
};

async function runBatch(
  count: number,
): Promise<{ publish: number; roundTrip: number }> {
  const dbPath = `/tmp/pbus-bench-${randomUUID()}.db`;
  const pubsub = await createRedisPubSub();

  const bus = createPersistentBus<BenchEvents, BenchEvents>({
    publisherName: "bench",
    sqlitePath: dbPath,
    pubsub,
    maxRetries: 3,
    pendingDelayMs: 86_400_000, // 24h — never fires during test
  });

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await bus.publish("bench", { seq: -i, ts: new Date().toISOString() });
  }

  // --- Publish-only measurement ---
  const pubStart = performance.now();
  for (let i = 0; i < count; i++) {
    await bus.publish("bench", { seq: i, ts: new Date().toISOString() });
  }
  const pubElapsed = performance.now() - pubStart;
  const publishTput = Math.round(count / (pubElapsed / 1000));

  // --- Round-trip measurement ---
  const received: number[] = [];
  let rtStart = 0;

  const rtTput = await new Promise<number>((resolve, reject) => {
    const tmo = setTimeout(() => reject(new Error("Timeout")), 30_000);

    bus.subscribe("bench", async () => {
      received.push(1);
      if (received.length === count) {
        clearTimeout(tmo);
        const elapsed = performance.now() - rtStart;
        resolve(Math.round(count / (elapsed / 1000)));
      }
    });

    // Wait a tick for subscriber registration
    setTimeout(async () => {
      rtStart = performance.now();
      for (let i = 0; i < count; i++) {
        await bus.publish("bench", {
          seq: i,
          ts: new Date().toISOString(),
        });
      }
    }, 100);
  });

  await bus.tryClose();
  await rm(dbPath).catch(() => {});

  return { publish: publishTput, roundTrip: rtTput };
}

async function benchmark() {
  console.log("\n=== persistent-bus Benchmark ===\n");

  const allPub: number[] = [];
  const allRt: number[] = [];

  for (const size of BATCH_SIZES) {
    const result = await runBatch(size);
    console.log(
      `Batch ${String(size).padStart(4)} | Publish: ${result.publish.toLocaleString()} msg/s | Round-trip: ${result.roundTrip.toLocaleString()} msg/s`,
    );
    allPub.push(result.publish);
    allRt.push(result.roundTrip);
  }

  const avgPub = allPub.reduce((a, b) => a + b, 0) / allPub.length;
  const avgRt = allRt.reduce((a, b) => a + b, 0) / allRt.length;

  console.log(
    `\nAverage publish:     ~${Math.round(avgPub).toLocaleString()} msg/s`,
  );
  console.log(
    `Average round-trip:  ~${Math.round(avgRt).toLocaleString()} msg/s`,
  );

  console.log(`\n(Node.js ${process.version}, Redis at ${REDIS_URL})`);
}

await benchmark();
process.exit(0);
