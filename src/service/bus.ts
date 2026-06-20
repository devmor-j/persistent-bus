import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../broker/events.ts";
import { createPubsub } from "../broker/pubsub.ts";
import { createPrisma } from "../prisma/prisma.ts";
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
  const prisma = createPrisma(sqlitePath);
  const pubsub = await createPubsub(redisUrl);

  const createOutbox = async (event: string, payload: any) => {
    const eventId = randomUUID();

    const envelope: EventEnvelope<typeof event, typeof payload> = {
      eventName: event,
      eventId,
      publishedBy: publisherName,
      publishedAt: new Date().toISOString(),
      payload,
    };

    const data = JSON.stringify(envelope);

    await prisma.outbox.create({
      data: {
        ...envelope,
        data,
      },
    });

    return {
      eventId,
      envelope: envelope as unknown as EventEnvelope<string, unknown>,
      data,
    } as any;
  };

  const findOutbox = (eventId: string) =>
    prisma.outbox.findUnique({
      where: { eventId },
      select: { retries: true },
    });

  const findOngoingOutbox = () =>
    prisma.outbox.findMany({
      where: {
        publishedBy: publisherName,
        status: { notIn: ["COMPLETED", "DEAD"] },
      },
    });

  const findPendingOutbox = (eventId: string) =>
    prisma.outbox.findUnique({
      where: {
        eventId,
        status: "PENDING",
      },
      select: { retries: true },
    });

  const markProcessingOutbox = (eventId: string) =>
    prisma.outbox.update({
      where: { eventId },
      data: { status: "PROCESSING" },
    });

  const markCompletedOutbox = (eventId: string) =>
    prisma.outbox.update({
      where: { eventId },
      data: { status: "COMPLETED" },
    });

  const incrementRetryOutbox = (eventId: string) =>
    prisma.outbox.update({
      where: { eventId },
      data: {
        retries: { increment: 1 },
      },
    });

  const decrementRetryOutbox = (eventId: string) =>
    prisma.outbox.update({
      where: {
        eventId,
        retries: { gt: 0 },
      },
      data: {
        retries: { decrement: 1 },
      },
    });

  const markDeadOutbox = (eventId: string, error: string) =>
    prisma.outbox.update({
      where: { eventId },
      data: {
        status: "DEAD",
        error,
      },
    });

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
