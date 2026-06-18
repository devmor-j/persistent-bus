export const logger = {
  fatal: console.error,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
  silent: () => void {},
};
