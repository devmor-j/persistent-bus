import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before } from "node:test";
import { createClient } from "redis";

export const TMP_DIR = "./tmp/test";
export const DEAD_RETRY = 10;

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
export async function createRedisClient(): Promise<RedisPubSub> {
  const { REDIS_URL } = process.env;
  const [publisher, subscriber] = await Promise.all([
    createClient({ url: REDIS_URL }).connect(),
    createClient({ url: REDIS_URL }).connect(),
  ]);

  let isClosing = false;

  const tryClose = async () => {
    if (isClosing) return;
    isClosing = true;
    process.off("SIGINT", tryClose);
    process.off("SIGTERM", tryClose);
    await Promise.allSettled([publisher.close(), subscriber.close()]);
  };

  process.on("SIGINT", tryClose);
  process.on("SIGTERM", tryClose);

  return {
    publish: publisher.publish.bind(publisher),
    subscribe: subscriber.subscribe.bind(subscriber),
    tryClose,
  };
}
