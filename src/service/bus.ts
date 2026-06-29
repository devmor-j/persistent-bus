import { randomUUID } from "node:crypto";
import type { EventEnvelope, PubSub } from "../broker/events.ts";
import { createSqliteDb } from "../db.ts";
import type { OutboxRow, RetriesResult } from "../db.types.ts";
import { getSql } from "../sql/statements.ts";
import { calculateRetryDelay, errorToString, sleep } from "../utils/utility.ts";

function assertPublisher(
  pubsub: PubSub,
): asserts pubsub is Required<Pick<PubSub, "publish">> {
  if (!pubsub.publish)
    throw new Error(
      "persistent-bus: publish() called but no publisher configured. Provide a pubsub object with a publish method.",
    );
}

function assertSubscriber(
  pubsub: PubSub,
): asserts pubsub is Required<Pick<PubSub, "subscribe">> {
  if (!pubsub.subscribe)
    throw new Error(
      "persistent-bus: subscribe() called but no subscriber configured. Provide a pubsub object with a subscribe method.",
    );
}

export interface PersistentBusOptions {
  publisherName: string;
  sqlitePath: string;
  pubsub: PubSub;
  /** Max retry attempts before marking an event DEAD (default: 10). */
  maxRetries?: number;
  /** Delay in ms before first pending retry check (default: 10_000). */
  pendingDelayMs?: number;
  /** Delay in ms between individual recall publishes (default: 200). */
  recallIntervalMs?: number;
}

export function createPersistentBus<
  PublisherEvents extends Record<string, unknown>,
  SubscriberEvents extends Record<string, unknown>,
>(options: PersistentBusOptions) {
  const {
    pubsub,
    sqlitePath,
    publisherName,
    maxRetries = 10,
    pendingDelayMs = 10_000,
    recallIntervalMs = 200,
  } = options;

  const db = createSqliteDb(sqlitePath);

  const nowISO = () => new Date().toISOString();

  // Prepared statements — compiled once, reused across all calls
  const stmt = {
    insert: db.prepare(getSql("insert")),
    selectRetries: db.prepare(getSql("selectRetries")),
    selectOngoing: db.prepare(getSql("selectOngoing")),
    selectPendingRetries: db.prepare(getSql("selectPendingRetries")),
    updateProcessing: db.prepare(getSql("updateProcessing")),
    updateCompleted: db.prepare(getSql("updateCompleted")),
    incrementRetry: db.prepare(getSql("incrementRetry")),
    decrementRetry: db.prepare(getSql("decrementRetry")),
    updateDead: db.prepare(getSql("updateDead")),
    selectDeadOutboxes: db.prepare(getSql("selectDeadOutboxes")),
    deleteDeadOutboxes: db.prepare(getSql("deleteDeadOutboxes")),
    deleteDeadOutboxesOlderThan: db.prepare(
      getSql("deleteDeadOutboxesOlderThan"),
    ),
  };

  const createOutbox = (event: string, payload: unknown) => {
    const eventId = randomUUID();
    const timestamp = nowISO();

    const envelope: EventEnvelope<string, unknown> = {
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

  const findOutbox = (eventId: string): RetriesResult | undefined =>
    stmt.selectRetries.get(eventId) as RetriesResult | undefined;

  const findOngoingOutbox = (): OutboxRow[] =>
    stmt.selectOngoing.all(publisherName) as unknown as OutboxRow[];

  const findPendingOutbox = (eventId: string): RetriesResult | undefined =>
    stmt.selectPendingRetries.get(eventId) as RetriesResult | undefined;

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

  const findDeadOutbox = (): OutboxRow[] =>
    stmt.selectDeadOutboxes.all(publisherName) as unknown as OutboxRow[];

  const recallOutgoingOutboxes = async () => {
    assertPublisher(pubsub);
    const ongoingOutboxEvents = findOngoingOutbox();

    for (const outboxEvent of ongoingOutboxEvents) {
      if (outboxEvent.retries >= maxRetries) continue;

      incrementRetryOutbox(outboxEvent.eventId);

      try {
        await pubsub.publish(outboxEvent.eventName, outboxEvent.data);
      } catch {
        decrementRetryOutbox(outboxEvent.eventId);
      }

      await sleep(recallIntervalMs);
    }
  };

  const recallDeadOutboxes = async () => {
    assertPublisher(pubsub);
    const deadOutboxEvents = findDeadOutbox();

    for (const outboxEvent of deadOutboxEvents) {
      try {
        await pubsub.publish(outboxEvent.eventName, outboxEvent.data);
      } catch {
        // Publish failed — event stays DEAD for a future retry.
      }

      await sleep(recallIntervalMs);
    }
  };

  const perishDeadOutboxes = (maxAgeDays = 7) => {
    if (maxAgeDays === 0) {
      stmt.deleteDeadOutboxes.run(publisherName);
    } else {
      const cutoff = new Date(
        Date.now() - maxAgeDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      stmt.deleteDeadOutboxesOlderThan.run(publisherName, cutoff);
    }
  };

  const createPublisher = async <N extends string, P>(event: N, payload: P) => {
    assertPublisher(pubsub);
    const { eventId, data } = createOutbox(event, payload);

    const retryIfPending = async () => {
      const pendingEvent = findPendingOutbox(eventId);
      if (!pendingEvent) return;

      if (pendingEvent.retries > maxRetries) {
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

    setTimeout(retryIfPending, pendingDelayMs);
    await pubsub.publish(event, data);
  };

  const createSubscriber = <N extends string, P>(
    event: N,
    handler: (envelope: EventEnvelope<N, P>) => void | Promise<void>,
  ) => {
    assertSubscriber(pubsub);
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
        const isDead = outboxEvent.retries > maxRetries;

        if (isDead) {
          markDeadOutbox(eventId, errorMessage);
        } else {
          incrementRetryOutbox(eventId);

          const retryDelay = calculateRetryDelay(outboxEvent.retries, {
            maxRetries,
          });
          setTimeout(() => {
            assertPublisher(pubsub);
            pubsub.publish(event, data).catch(() => {});
          }, retryDelay).unref();
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
    recallOutgoingOutboxes,
    recallDeadOutboxes,
    perishDeadOutboxes,
    tryClose: () => pubsub.tryClose?.() ?? Promise.resolve(),
  };
}
