export type EventEnvelope<N extends string, P> = {
  readonly eventName: N;
  readonly eventId: string;
  readonly payload: P;
  readonly publishedBy: string;
  readonly publishedAt: string;
  processedBy?: string;
  processedAt?: string;
};

export type Handler<N extends string, P> = (
  envelope: EventEnvelope<N, P>,
) => void | Promise<void>;

export type EventPayloadMap<T extends Record<string, Handler<string, any>>> = {
  [K in keyof T]: T[K] extends Handler<string, infer P> ? P : never;
};

/**
 * Minimal pub/sub interface that users must provide.
 * Typically backed by Redis, but any pub/sub system satisfying this
 * interface works. The instance must already be connected.
 */
export interface PubSub {
  publish?(channel: string, message: string): Promise<number>;
  subscribe?(
    channel: string,
    listener: (message: string) => void,
  ): Promise<void> | void;
  tryClose?(): Promise<void>;
}

export type Publisher = Pick<PubSub, "publish" | "tryClose">;
export type Subscriber = Pick<PubSub, "subscribe" | "tryClose">;
