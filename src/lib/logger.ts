import { PostHog } from 'posthog-node';

const isDev = process.env.NODE_ENV === 'development';

// Lazy-init PostHog client for production (singleton)
let posthogClient: PostHog | null = null;

function getPostHog(): PostHog | null {
  if (isDev) return null;

  if (!posthogClient) {
    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!apiKey) {
      console.warn(
        '[Logger] NEXT_PUBLIC_POSTHOG_KEY not set, skipping PostHog'
      );
      return null;
    }

    posthogClient = new PostHog(apiKey, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      // Next.js server functions are short-lived, flush immediately
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return posthogClient;
}

type LogProperties = Record<string, unknown>;

/**
 * Server-side structured logger
 * - Development: logs to console
 * - Production: sends to PostHog
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
    getPostHog()?.capture({
      distinctId: 'server',
      event: `server:${event}`,
      properties: { level: 'info', ...properties },
    });
  },

  /**
   * Log warnings (non-critical issues, fallbacks used)
   */
  warn: (event: string, properties?: LogProperties) => {
    if (isDev) {
      console.warn(`[WARN] ${event}`, properties ?? '');
      return;
    }
    getPostHog()?.capture({
      distinctId: 'server',
      event: `server:${event}`,
      properties: { level: 'warn', ...properties },
    });
  },

  /**
   * Log errors (failures, exceptions)
   */
  error: (event: string, properties?: LogProperties) => {
    if (isDev) {
      console.error(`[ERROR] ${event}`, properties ?? '');
      return;
    }
    getPostHog()?.capture({
      distinctId: 'server',
      event: `server:error:${event}`,
      properties: { level: 'error', ...properties },
    });
  },

  /**
   * Debug logs - only in development, never sent to PostHog
   */
  debug: (message: string, properties?: LogProperties) => {
    if (isDev) {
      console.log(`[DEBUG] ${message}`, properties ?? '');
    }
    // Never send debug to PostHog
  },

  /**
   * Flush pending events - call at end of request handlers if needed
   */
  flush: async () => {
    await getPostHog()?.flush();
  },

  /**
   * Shutdown PostHog client gracefully
   */
  shutdown: async () => {
    await posthogClient?.shutdown();
    posthogClient = null;
  },
};
