const isDev = process.env.NODE_ENV === 'development';

type LogProperties = Record<string, unknown>;

/**
 * Emit one structured line to stdout.
 *
 * Production logging goes to the platform log stream rather than to an
 * analytics product (REG-746). Two reasons.
 *
 * The operational one: everything we actually reach for during an incident is
 * already there next to it, and correlated by time. Request paths, status
 * codes, response times, restarts, crash traces. Splitting half the picture
 * into a separate product meant neither half was complete.
 *
 * The mechanical one: the previous sink held every event in a client-side queue
 * with its own retry chain, which retained request scope whenever ingest was
 * unavailable and grew for as long as that lasted. A write to stdout cannot do
 * that. It has no queue, no retry, and no failure mode of its own.
 *
 * JSON rather than key=value so that a value containing a space or a quote
 * cannot corrupt the line, and so the output stays parseable.
 */
function emit(level: string, event: string, properties?: LogProperties) {
  const line = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...properties,
  });

  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

/**
 * Server-side structured logger.
 *
 * Development keeps the readable console format; production emits one JSON
 * object per line, searchable with `render logs --text <term>`.
 */
export const logger = {
  /**
   * Log informational events (record created, key updated, etc.)
   */
  info: (event: string, properties?: LogProperties) => {
    if (isDev) {
      console.log(`[INFO] ${event}`, properties ?? '');
      return;
    }
    emit('info', event, properties);
  },

  /**
   * Log warnings (non-critical issues, fallbacks used)
   */
  warn: (event: string, properties?: LogProperties) => {
    if (isDev) {
      console.warn(`[WARN] ${event}`, properties ?? '');
      return;
    }
    emit('warn', event, properties);
  },

  /**
   * Log errors (failures, exceptions)
   */
  error: (event: string, properties?: LogProperties) => {
    if (isDev) {
      console.error(`[ERROR] ${event}`, properties ?? '');
      return;
    }
    emit('error', event, properties);
  },

  /**
   * Debug logs - only in development, never emitted in production
   */
  debug: (message: string, properties?: LogProperties) => {
    if (isDev) {
      console.log(`[DEBUG] ${message}`, properties ?? '');
    }
  },
};
