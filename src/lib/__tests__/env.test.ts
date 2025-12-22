import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getClientEnv,
  getGoogleCredentials,
  hasFeatureConfig,
  isPullRequestPreview,
} from '../env';

describe('Environment Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isPullRequestPreview', () => {
    it('should return true when IS_PULL_REQUEST is "true"', () => {
      process.env.IS_PULL_REQUEST = 'true';
      expect(isPullRequestPreview()).toBe(true);
    });

    it('should return false when IS_PULL_REQUEST is "false"', () => {
      process.env.IS_PULL_REQUEST = 'false';
      expect(isPullRequestPreview()).toBe(false);
    });

    it('should return false when IS_PULL_REQUEST is not set', () => {
      delete process.env.IS_PULL_REQUEST;
      expect(isPullRequestPreview()).toBe(false);
    });
  });

  describe('getGoogleCredentials', () => {
    it('should return production credentials when not in preview', () => {
      process.env.IS_PULL_REQUEST = 'false';
      process.env.GOOGLE_CLIENT_ID = 'prod-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'prod-client-secret';

      const creds = getGoogleCredentials();

      expect(creds.clientId).toBe('prod-client-id');
      expect(creds.clientSecret).toBe('prod-client-secret');
    });

    it('should return preview credentials when in preview', () => {
      process.env.IS_PULL_REQUEST = 'true';
      process.env.PREVIEW_GOOGLE_CLIENT_ID = 'preview-client-id';
      process.env.PREVIEW_GOOGLE_CLIENT_SECRET = 'preview-client-secret';
      process.env.GOOGLE_CLIENT_ID = 'prod-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'prod-client-secret';

      const creds = getGoogleCredentials();

      expect(creds.clientId).toBe('preview-client-id');
      expect(creds.clientSecret).toBe('preview-client-secret');
    });

    it('should return empty strings when credentials are not set', () => {
      process.env.IS_PULL_REQUEST = 'false';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const creds = getGoogleCredentials();

      expect(creds.clientId).toBe('');
      expect(creds.clientSecret).toBe('');
    });
  });

  describe('hasFeatureConfig', () => {
    describe('database feature', () => {
      it('should return true when DATABASE_URL is set', () => {
        process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
        expect(hasFeatureConfig('database')).toBe(true);
      });

      it('should return true when POSTGRES_PRISMA_URL is set', () => {
        delete process.env.DATABASE_URL;
        process.env.POSTGRES_PRISMA_URL = 'postgresql://localhost:5432/test';
        expect(hasFeatureConfig('database')).toBe(true);
      });

      it('should return false when no database URL is set', () => {
        delete process.env.DATABASE_URL;
        delete process.env.POSTGRES_PRISMA_URL;
        expect(hasFeatureConfig('database')).toBe(false);
      });
    });

    describe('auth feature', () => {
      it('should return true when all auth config is set', () => {
        process.env.GOOGLE_CLIENT_ID = 'client-id';
        process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
        process.env.NEXTAUTH_SECRET = 'super-secret-key-for-auth';

        expect(hasFeatureConfig('auth')).toBe(true);
      });

      it('should return false when partial auth config is set', () => {
        process.env.GOOGLE_CLIENT_ID = 'client-id';
        delete process.env.GOOGLE_CLIENT_SECRET;
        delete process.env.NEXTAUTH_SECRET;

        expect(hasFeatureConfig('auth')).toBe(false);
      });
    });

    describe('gcp feature', () => {
      it('should return true when GCP config is set', () => {
        process.env.GOOGLE_CLOUD_PROJECT_ID = 'project-id';
        process.env.CLOUD_FUNCTION_URL = 'https://cloud-function.run.app';

        expect(hasFeatureConfig('gcp')).toBe(true);
      });

      it('should return false when GCP config is missing', () => {
        delete process.env.GOOGLE_CLOUD_PROJECT_ID;
        delete process.env.CLOUD_FUNCTION_URL;

        expect(hasFeatureConfig('gcp')).toBe(false);
      });
    });
  });

  describe('getClientEnv', () => {
    it('should return client environment variables', () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'public-client-id';

      const env = getClientEnv();

      expect(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBe('public-client-id');
    });

    it('should return undefined for missing client variables', () => {
      delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

      const env = getClientEnv();

      expect(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBeUndefined();
    });
  });
});
