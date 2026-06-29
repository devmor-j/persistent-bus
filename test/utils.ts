import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before } from "node:test";
import { createClient } from "redis";

export const TMP_DIR = "./tmp/test";
export const DEAD_RETRY = 10;

const { REDIS_URL } = process.env;

await mkdir(TMP_DIR, { recursive: true });

export interface CreateTmpDbOptions {
  filename?: string;
}

export function randomEventName() {
  return `evt_${randomUUID().slice(0, 8)}`;
}

export function useTmpDir() {
  const dir = `${TMP_DIR}/${randomUUID().slice(0, 8)}`;

  before(async () => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  return { tmpDbPath: () => `${dir}/${randomUUID()}.db` };
}

export async function createTmpDb({
  filename = `${randomUUID()}.db`,
}: CreateTmpDbOptions = {}): Promise<string> {
  return join(TMP_DIR, filename);
}

export async function writeTmpFile(
  content: string,
  filename = randomUUID(),
): Promise<string> {
  const filepath = join(TMP_DIR, filename);
  await writeFile(filepath, content);
  return filepath;
}

export function tryDeleteFile(filepath: string) {
  return rm(filepath, { force: true }).catch(() => {});
}

export function createTestEvent<P = Record<string, unknown>>(
  eventName: string,
  payload: P,
) {
  return {
    eventName,
    eventId: randomUUID(),
    publishedBy: "test",
    publishedAt: new Date().toISOString(),
    payload,
  };
}

export function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal pub/sub interface matching what createPersistentBus expects. */
export interface RedisPubSub {
  publish(channel: string, message: string): Promise<number>;
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<void> | void;
  tryClose(): Promise<void>;
}

/** Create a PubSub from two Redis clients (publisher + subscriber). */
export async function createRedisPubSub(url = REDIS_URL): Promise<RedisPubSub> {
  const [publisher, subscriber] = await Promise.all([
    createClient({ url }).connect(),
    createClient({ url }).connect(),
  ]);

  let isClosing = false;

  const tryClose = async () => {
    if (isClosing) return;
    isClosing = true;

    process.off("SIGINT", tryClose);
    process.off("SIGTERM", tryClose);

    await Promise.race([
      Promise.allSettled([publisher.close(), subscriber.close()]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Close timeout")), 10_000),
      ),
    ]);
  };

  process.on("SIGINT", tryClose);
  process.on("SIGTERM", tryClose);

  return {
    // redis methods lose `this` when destructured; .bind() preserves context
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
    tryClose,
  };
}
