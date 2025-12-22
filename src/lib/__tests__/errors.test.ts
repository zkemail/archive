import { describe, expect, it } from 'vitest';

import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  DatabaseError,
  DnsLookupError,
  ExternalServiceError,
  formatErrorResponse,
  isAppError,
  isOperationalError,
  NotFoundError,
  RateLimitError,
  toAppError,
  ValidationError,
} from '../errors';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create an error with default values', () => {
      const error = new AppError('Test error', 'TEST_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.name).toBe('AppError');
    });

    it('should create an error with custom values', () => {
      const error = new AppError('Custom error', 'CUSTOM', 400, false);

      expect(error.statusCode).toBe(400);
      expect(error.isOperational).toBe(false);
    });

    it('should serialize to JSON correctly', () => {
      const error = new AppError('Test', 'TEST');
      const json = error.toJSON();

      expect(json).toHaveProperty('name', 'AppError');
      expect(json).toHaveProperty('code', 'TEST');
      expect(json).toHaveProperty('message', 'Test');
      expect(json).toHaveProperty('timestamp');
    });
  });

  describe('DatabaseError', () => {
    it('should create a database error', () => {
      const originalError = new Error('Connection failed');
      const error = new DatabaseError('DB operation failed', originalError);

      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('DnsLookupError', () => {
    it('should create a DNS lookup error with default message', () => {
      const error = new DnsLookupError('example.com', 'selector1');

      expect(error.domain).toBe('example.com');
      expect(error.selector).toBe('selector1');
      expect(error.message).toContain('selector1._domainkey.example.com');
      expect(error.statusCode).toBe(404);
    });

    it('should create a DNS lookup error with custom message', () => {
      const error = new DnsLookupError(
        'example.com',
        'selector1',
        'Custom DNS error'
      );

      expect(error.message).toBe('Custom DNS error');
    });
  });

  describe('RateLimitError', () => {
    it('should create a rate limit error', () => {
      const error = new RateLimitError(60);

      expect(error.retryAfter).toBe(60);
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_ERROR');
    });

    it('should set resetAt correctly', () => {
      const resetAt = new Date(Date.now() + 60000);
      const error = new RateLimitError(60, resetAt);

      expect(error.resetAt).toBe(resetAt);
    });
  });

  describe('ValidationError', () => {
    it('should create a validation error', () => {
      const details = { field: 'email', issue: 'invalid format' };
      const error = new ValidationError('Invalid input', details, 'email');

      expect(error.details).toEqual(details);
      expect(error.field).toBe('email');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('AuthenticationError', () => {
    it('should create an authentication error with default message', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('Authentication required');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('AuthorizationError', () => {
    it('should create an authorization error', () => {
      const error = new AuthorizationError('Access denied', 'admin');

      expect(error.requiredPermission).toBe('admin');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('NotFoundError', () => {
    it('should create a not found error', () => {
      const error = new NotFoundError('Resource not found', 'User', '123');

      expect(error.resourceType).toBe('User');
      expect(error.resourceId).toBe('123');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ExternalServiceError', () => {
    it('should create an external service error', () => {
      const originalError = new Error('API timeout');
      const error = new ExternalServiceError(
        'Gmail API',
        'Service unavailable',
        originalError
      );

      expect(error.service).toBe('Gmail API');
      expect(error.originalError).toBe(originalError);
      expect(error.statusCode).toBe(502);
    });
  });

  describe('ConfigurationError', () => {
    it('should create a configuration error', () => {
      const error = new ConfigurationError('Missing config', 'DATABASE_URL');

      expect(error.configKey).toBe('DATABASE_URL');
      expect(error.isOperational).toBe(false);
    });
  });
});

describe('Error Helpers', () => {
  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new AppError('Test', 'TEST'))).toBe(true);
      expect(isAppError(new ValidationError('Test'))).toBe(true);
    });

    it('should return false for non-AppError instances', () => {
      expect(isAppError(new Error('Test'))).toBe(false);
      expect(isAppError('string')).toBe(false);
      expect(isAppError(null)).toBe(false);
    });
  });

  describe('isOperationalError', () => {
    it('should return true for operational errors', () => {
      expect(isOperationalError(new AppError('Test', 'TEST'))).toBe(true);
    });

    it('should return false for non-operational errors', () => {
      expect(isOperationalError(new ConfigurationError('Test'))).toBe(false);
      expect(isOperationalError(new Error('Test'))).toBe(false);
    });
  });

  describe('toAppError', () => {
    it('should return the same error if already AppError', () => {
      const error = new AppError('Test', 'TEST');
      expect(toAppError(error)).toBe(error);
    });

    it('should convert Error to AppError', () => {
      const error = new Error('Test error');
      const appError = toAppError(error);

      expect(appError.message).toBe('Test error');
      expect(appError.code).toBe('UNKNOWN_ERROR');
    });

    it('should convert string to AppError', () => {
      const appError = toAppError('String error');

      expect(appError.message).toBe('String error');
    });

    it('should handle unknown types', () => {
      const appError = toAppError({ random: 'object' });

      expect(appError.message).toBe('An unexpected error occurred');
    });
  });

  describe('formatErrorResponse', () => {
    it('should format AppError correctly', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      const response = formatErrorResponse(error);

      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(response.error.message).toBe('Invalid input');
      expect(response.error.details).toEqual({ field: 'email' });
    });

    it('should format RateLimitError with retry info', () => {
      const error = new RateLimitError(60);
      const response = formatErrorResponse(error);

      expect(response.error.retryAfter).toBe(60);
      expect(response.error.resetAt).toBeDefined();
    });

    it('should format regular Error', () => {
      const error = new Error('Regular error');
      const response = formatErrorResponse(error);

      expect(response.error.code).toBe('UNKNOWN_ERROR');
    });
  });
});
