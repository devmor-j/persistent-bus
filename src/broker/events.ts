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
