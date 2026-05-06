import posthog from 'posthog-js';

// Only initialize PostHog in production
if (process.env.NODE_ENV === 'production') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    // Use 2025 defaults - includes automatic pageview tracking via history_change
    defaults: '2025-11-30',
    // Disable session recording by default
    disable_session_recording: true,
    person_profiles: 'always',
  });
}
