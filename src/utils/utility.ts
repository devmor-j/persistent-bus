export function sleep(duration: number) {
  return new Promise((res) => setTimeout(res, duration, duration));
}

export function calculateRetryDelay(
  retries = 0,
  options: {
    maxRetries?: number;
    maxDelay?: number;
    base?: number;
    jitter?: number;
  } = {},
) {
  const {
    maxRetries = 3,
    maxDelay = 60_000,
    base = 2,
    jitter = 0.25,
  } = options;

  const delay = Math.min(
    Math.pow(base, retries) * (maxDelay / Math.pow(base, maxRetries)),
    maxDelay,
  );

  return delay * (1 + jitter * Math.random());
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    maxDelay?: number;
  } = {},
): Promise<T> {
  const { retries = 5, maxDelay = 30_000 } = options;

  let lastError: unknown;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (i < retries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, calculateRetryDelay(i, { maxDelay })),
        );
      }
    }
  }

  throw lastError;
}

export function errorToString(error: unknown): string {
  if (!error) return "none";

  if (error instanceof Error) {
    return error.message || error.stack || error.toString();
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }

    if ("error" in error) {
      const err = error.error;
      if (typeof err === "string") {
        return err;
      }
      if (err && typeof err === "object") {
        return errorToString(err);
      }
    }

    return JSON.stringify(error);
  }

  return String(error);
}

export interface DeferredPromise<T = unknown> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T = unknown>() {
  const deferred = {} as DeferredPromise<T>;

  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  }) as Promise<T>;

  return deferred;
}
