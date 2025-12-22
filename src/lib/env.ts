import { z } from 'zod';

/**
 * Type-safe environment variable validation using Zod
 * This module provides validated access to environment variables
 */

// Server-side environment schema (full validation)
const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().optional(),
  POSTGRES_PRISMA_URL: z.string().url().optional(),
  POSTGRES_URL_NON_POOLING: z.string().url().optional(),

  // Authentication
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(16).optional(),

  // Preview environment credentials
  PREVIEW_GOOGLE_CLIENT_ID: z.string().optional(),
  PREVIEW_GOOGLE_CLIENT_SECRET: z.string().optional(),
  IS_PULL_REQUEST: z.enum(['true', 'false']).default('false'),

  // Google Cloud Platform
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_REGION: z.string().default('us-central1'),
  CLOUD_TASKS_QUEUE_NAME: z.string().optional(),
  CLOUD_FUNCTION_URL: z.string().url().optional(),
  TASKS_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),

  // Security
  CRON_SECRET: z.string().min(16).optional(),

  // Node environment
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

// Client-side environment schema (only NEXT_PUBLIC_ variables)
const clientEnvSchema = z.object({
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),
});

// Type exports
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Parse and validate server environment variables
 * Call this on server-side only
 */
export function getServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    console.error(result.error.format());

    // In development, warn but don't crash
    if (process.env.NODE_ENV === 'development') {
      console.warn('Using partial environment in development mode');
      return serverEnvSchema.parse({
        ...process.env,
        NODE_ENV: 'development',
      });
    }

    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

/**
 * Parse and validate client environment variables
 * Safe to call on client-side
 */
export function getClientEnv(): ClientEnv {
  return clientEnvSchema.parse({
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  });
}

/**
 * Check if we're in a pull request preview environment
 */
export function isPullRequestPreview(): boolean {
  return process.env.IS_PULL_REQUEST === 'true';
}

/**
 * Get the appropriate Google OAuth credentials based on environment
 */
export function getGoogleCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const isPreview = isPullRequestPreview();

  return {
    clientId: isPreview
      ? (process.env.PREVIEW_GOOGLE_CLIENT_ID ?? '')
      : (process.env.GOOGLE_CLIENT_ID ?? ''),
    clientSecret: isPreview
      ? (process.env.PREVIEW_GOOGLE_CLIENT_SECRET ?? '')
      : (process.env.GOOGLE_CLIENT_SECRET ?? ''),
  };
}

/**
 * Check if required environment variables for a feature are present
 */
export function hasFeatureConfig(
  feature: 'database' | 'auth' | 'gcp'
): boolean {
  switch (feature) {
    case 'database':
      return Boolean(
        process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL
      );
    case 'auth':
      return Boolean(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.NEXTAUTH_SECRET
      );
    case 'gcp':
      return Boolean(
        process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.CLOUD_FUNCTION_URL
      );
    default:
      return false;
  }
}
