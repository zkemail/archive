import posthog from 'posthog-js';

const isDev = process.env.NODE_ENV === 'development';
const isBrowser = typeof window !== 'undefined';

export const analytics = {
  capture: (event: string, properties?: Record<string, unknown>) => {
    if (!isBrowser) return; // SSR safety

    if (isDev) {
      console.log(
        `%c[Analytics] ${event}`,
        'color: #7c3aed; font-weight: bold;',
        properties ?? ''
      );
      return;
    }
    posthog.capture(event, properties);
  },

  identify: (userId: string, properties?: Record<string, unknown>) => {
    if (!isBrowser) return;

    if (isDev) {
      console.log(
        `%c[Analytics] identify`,
        'color: #7c3aed; font-weight: bold;',
        { userId, ...properties }
      );
      return;
    }
    posthog.identify(userId, properties);
  },

  reset: () => {
    if (!isBrowser) return;

    if (isDev) {
      console.log('%c[Analytics] reset', 'color: #7c3aed; font-weight: bold;');
      return;
    }
    posthog.reset();
  },
};
