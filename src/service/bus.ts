import { and, eq, notInArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../broker/events.ts";
import { createPubsub } from "../broker/pubsub.ts";
import { createDb } from "../drizzle/client.ts";
import { outbox } from "../drizzle/schema/index.ts";
import { calculateRetryDelay, errorToString, sleep } from "../utils/utility.ts";

const DEAD_RETRY = 10;
const PENDING_DELAY = 10_000;
const RECALL_SLEEP = 200;

export interface PersistentBusOptions {
  publisherName: string;
  redisUrl: string;
  sqlitePath: string;
}

export async function createPersistentBus<
  PublisherEvents extends Record<string, any>,
  SubscriberEvents extends Record<string, any>,
>(options: PersistentBusOptions) {
  const { redisUrl, sqlitePath, publisherName } = options;
  const db = createDb(sqlitePath);
  const pubsub = await createPubsub(redisUrl);

  const now = () => new Date().toISOString();

  const createOutbox = async (event: string, payload: any) => {
    const eventId = randomUUID();

    const envelope: EventEnvelope<typeof event, typeof payload> = {
      eventName: event,
      eventId,
      publishedBy: publisherName,
      publishedAt: now(),
      payload,
    };

    const data = JSON.stringify(envelope);

    db.insert(outbox)
      .values({
        ...envelope,
        data,
      })
      .run();

    return {
      eventId,
      envelope: envelope as unknown as EventEnvelope<string, unknown>,
      data,
    } as any;
  };

  const findOutbox = (eventId: string) =>
    db
      .select({ retries: outbox.retries })
      .from(outbox)
      .where(eq(outbox.eventId, eventId))
      .get();

  const findOngoingOutbox = () =>
    db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.publishedBy, publisherName),
          notInArray(outbox.status, ["COMPLETED", "DEAD"]),
        ),
      )
      .all();

  const findPendingOutbox = (eventId: string) =>
    db
      .select({ retries: outbox.retries })
      .from(outbox)
      .where(and(eq(outbox.eventId, eventId), eq(outbox.status, "PENDING")))
      .get();

  const markProcessingOutbox = (eventId: string) =>
    db
      .update(outbox)
      .set({ status: "PROCESSING", updatedAt: now() })
      .where(eq(outbox.eventId, eventId))
      .run();

  const markCompletedOutbox = (eventId: string) =>
    db
      .update(outbox)
      .set({ status: "COMPLETED", updatedAt: now() })
      .where(eq(outbox.eventId, eventId))
      .run();

  const incrementRetryOutbox = (eventId: string) =>
    db
      .update(outbox)
      .set({ retries: sql`${outbox.retries} + 1`, updatedAt: now() })
      .where(eq(outbox.eventId, eventId))
      .run();

  const decrementRetryOutbox = (eventId: string) =>
    db
      .update(outbox)
      .set({ retries: sql`${outbox.retries} - 1`, updatedAt: now() })
      .where(and(eq(outbox.eventId, eventId), sql`${outbox.retries} > 0`))
      .run();

  const markDeadOutbox = (eventId: string, error: string) =>
    db
      .update(outbox)
      .set({ status: "DEAD", error, updatedAt: now() })
      .where(eq(outbox.eventId, eventId))
      .run();

  const recallOutbox = async () => {
    const ongoingOutboxEvents = await findOngoingOutbox();

    for (const outboxEvent of ongoingOutboxEvents) {
      const isDead = outboxEvent.retries >= DEAD_RETRY;

      if (isDead) {
        await markDeadOutbox(outboxEvent.eventId, "recall:dead");
      } else {
        await incrementRetryOutbox(outboxEvent.eventId);

        try {
          await pubsub.publish(outboxEvent.eventName, outboxEvent.data);
        } catch {
          await decrementRetryOutbox(outboxEvent.eventId);
        }
      }

      await sleep(RECALL_SLEEP);
    }
  };

  const createPublisher = async <N extends string, P>(event: N, payload: P) => {
    const { eventId, data } = await createOutbox(event, payload);

    const retryIfPending = async () => {
      const pendingEvent = await findPendingOutbox(eventId);
      if (!pendingEvent) return;

      if (pendingEvent.retries > DEAD_RETRY) {
        await markDeadOutbox(eventId, "retry:dead");
      } else {
        await incrementRetryOutbox(eventId);

        try {
          await pubsub.publish(event, data);

          const retryDelay = calculateRetryDelay(pendingEvent.retries);
          setTimeout(retryIfPending, retryDelay).unref();
        } catch {
          await decrementRetryOutbox(eventId);
        }
      }
    };

    setTimeout(retryIfPending, PENDING_DELAY);
    await pubsub.publish(event, data);
  };

  const createSubscriber = <N extends string, P>(
    event: N,
    handler: (envelope: EventEnvelope<N, P>) => void | Promise<void>,
  ) => {
    pubsub.subscribe(event, async (data: string) => {
      const envelope = JSON.parse(data) as EventEnvelope<N, P>;
      const { eventId } = envelope;

      await markProcessingOutbox(eventId);

      try {
        await handler(envelope);
        await markCompletedOutbox(eventId);
      } catch (err) {
        const outboxEvent = await findOutbox(eventId);
        if (!outboxEvent) return;

        const errorMessage = errorToString(err);
        const isDead = outboxEvent.retries > DEAD_RETRY;

        if (isDead) {
          await markDeadOutbox(eventId, errorMessage);
        } else {
          await incrementRetryOutbox(eventId);

          const retryDelay = calculateRetryDelay(outboxEvent.retries);
          setTimeout(() => pubsub.publish(event, data), retryDelay).unref();
        }
      }
    });
  };

  const publish = <K extends Extract<keyof PublisherEvents, string>>(
    eventName: K,
    payload: PublisherEvents[K],
  ): Promise<void> => createPublisher(eventName, payload);

  const subscribe = <K extends Extract<keyof SubscriberEvents, string>>(
    eventName: K,
    handler: (
      envelope: EventEnvelope<K, SubscriberEvents[K]>,
    ) => void | Promise<void>,
  ) => createSubscriber(eventName, handler);

  return {
    publish,
    subscribe,
    recallOutbox,
    tryClose: pubsub.tryClose,
  };
}
