import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../broker/events.ts";
import { createPubsub } from "../broker/pubsub.ts";
import { createSqliteDb } from "../db.ts";
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

  const db = createSqliteDb(sqlitePath);
  const pubsub = await createPubsub(redisUrl);

  const nowISO = () => new Date().toISOString();

  // Prepared statements — compiled once, reused across all calls
  const stmt = {
    insert: db.prepare(
      "INSERT INTO Outbox (id, createdAt, updatedAt, eventName, eventId, publishedBy, publishedAt, payload, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    selectRetries: db.prepare("SELECT retries FROM Outbox WHERE eventId = ?"),
    selectOngoing: db.prepare(
      "SELECT * FROM Outbox WHERE publishedBy = ? AND status NOT IN ('COMPLETED', 'DEAD')",
    ),
    selectPendingRetries: db.prepare(
      "SELECT retries FROM Outbox WHERE eventId = ? AND status = 'PENDING'",
    ),
    updateProcessing: db.prepare(
      "UPDATE Outbox SET status = 'PROCESSING', updatedAt = ? WHERE eventId = ?",
    ),
    updateCompleted: db.prepare(
      "UPDATE Outbox SET status = 'COMPLETED', updatedAt = ? WHERE eventId = ?",
    ),
    incrementRetry: db.prepare(
      "UPDATE Outbox SET retries = retries + 1, updatedAt = ? WHERE eventId = ?",
    ),
    decrementRetry: db.prepare(
      "UPDATE Outbox SET retries = retries - 1, updatedAt = ? WHERE eventId = ? AND retries > 0",
    ),
    updateDead: db.prepare(
      "UPDATE Outbox SET status = 'DEAD', error = ?, updatedAt = ? WHERE eventId = ?",
    ),
  };

  const createOutbox = (event: string, payload: any) => {
    const eventId = randomUUID();
    const timestamp = nowISO();

    const envelope: EventEnvelope<typeof event, typeof payload> = {
      eventName: event,
      eventId,
      publishedBy: publisherName,
      publishedAt: timestamp,
      payload,
    };

    const data = JSON.stringify(envelope);

    stmt.insert.run(
      eventId,
      timestamp,
      timestamp,
      event,
      eventId,
      publisherName,
      timestamp,
      JSON.stringify(payload),
      data,
    );

    return {
      eventId,
      envelope,
      data,
    };
  };

  const findOutbox = (eventId: string) =>
    stmt.selectRetries.get(eventId) as { retries: number } | undefined;

  const findOngoingOutbox = () =>
    stmt.selectOngoing.all(publisherName) as any[];

  const findPendingOutbox = (eventId: string) =>
    stmt.selectPendingRetries.get(eventId) as { retries: number } | undefined;

  const markProcessingOutbox = (eventId: string) =>
    stmt.updateProcessing.run(nowISO(), eventId);

  const markCompletedOutbox = (eventId: string) =>
    stmt.updateCompleted.run(nowISO(), eventId);

  const incrementRetryOutbox = (eventId: string) =>
    stmt.incrementRetry.run(nowISO(), eventId);

  const decrementRetryOutbox = (eventId: string) =>
    stmt.decrementRetry.run(nowISO(), eventId);

  const markDeadOutbox = (eventId: string, error: string) =>
    stmt.updateDead.run(error, nowISO(), eventId);

  const recallOutbox = async () => {
    const ongoingOutboxEvents = findOngoingOutbox();

    for (const outboxEvent of ongoingOutboxEvents) {
      const isDead = outboxEvent.retries >= DEAD_RETRY;

      if (isDead) {
        markDeadOutbox(outboxEvent.eventId, "recall:dead");
      } else {
        incrementRetryOutbox(outboxEvent.eventId);

        try {
          await pubsub.publish(outboxEvent.eventName, outboxEvent.data);
        } catch {
          decrementRetryOutbox(outboxEvent.eventId);
        }
      }

      await sleep(RECALL_SLEEP);
    }
  };

  const createPublisher = async <N extends string, P>(event: N, payload: P) => {
    const { eventId, data } = createOutbox(event, payload);

    const retryIfPending = async () => {
      const pendingEvent = findPendingOutbox(eventId);
      if (!pendingEvent) return;

      if (pendingEvent.retries > DEAD_RETRY) {
        markDeadOutbox(eventId, "retry:dead");
      } else {
        incrementRetryOutbox(eventId);

        try {
          await pubsub.publish(event, data);

          const retryDelay = calculateRetryDelay(pendingEvent.retries);
          setTimeout(retryIfPending, retryDelay).unref();
        } catch {
          decrementRetryOutbox(eventId);
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

      markProcessingOutbox(eventId);

      try {
        await handler(envelope);
        markCompletedOutbox(eventId);
      } catch (err) {
        const outboxEvent = findOutbox(eventId);
        if (!outboxEvent) return;

        const errorMessage = errorToString(err);
        const isDead = outboxEvent.retries > DEAD_RETRY;

        if (isDead) {
          markDeadOutbox(eventId, errorMessage);
        } else {
          incrementRetryOutbox(eventId);

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
