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
