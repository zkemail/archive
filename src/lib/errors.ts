/**
 * Custom error types for the Archive application
 * Provides structured error handling with error codes and HTTP status codes
 */

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends AppError {
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message, 'DATABASE_ERROR', 500, true);
    this.name = 'DatabaseError';
    this.originalError = originalError;

    if (originalError) {
      this.cause = originalError;
    }
  }
}

/**
 * DNS lookup errors for DKIM record retrieval
 */
export class DnsLookupError extends AppError {
  public readonly domain: string;
  public readonly selector: string;

  constructor(domain: string, selector: string, message?: string) {
    super(
      message ?? `DNS lookup failed for ${selector}._domainkey.${domain}`,
      'DNS_LOOKUP_ERROR',
      404,
      true
    );
    this.name = 'DnsLookupError';
    this.domain = domain;
    this.selector = selector;
  }
}

/**
 * Rate limit exceeded errors
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;
  public readonly resetAt: Date;

  constructor(retryAfter: number, resetAt?: Date) {
    super('Rate limit exceeded', 'RATE_LIMIT_ERROR', 429, true);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.resetAt = resetAt ?? new Date(Date.now() + retryAfter * 1000);
  }
}

/**
 * Input validation errors
 */
export class ValidationError extends AppError {
  public readonly details?: unknown;
  public readonly field?: string;

  constructor(message: string, details?: unknown, field?: string) {
    super(message, 'VALIDATION_ERROR', 400, true);
    this.name = 'ValidationError';
    this.details = details;
    this.field = field;
  }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401, true);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization errors (authenticated but not permitted)
 */
export class AuthorizationError extends AppError {
  public readonly requiredPermission?: string;

  constructor(
    message: string = 'Permission denied',
    requiredPermission?: string
  ) {
    super(message, 'AUTHORIZATION_ERROR', 403, true);
    this.name = 'AuthorizationError';
    this.requiredPermission = requiredPermission;
  }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends AppError {
  public readonly resourceType?: string;
  public readonly resourceId?: string;

  constructor(message: string, resourceType?: string, resourceId?: string) {
    super(message, 'NOT_FOUND_ERROR', 404, true);
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * External service errors (GCP, Gmail API, etc.)
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError?: Error;

  constructor(service: string, message: string, originalError?: Error) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 502, true);
    this.name = 'ExternalServiceError';
    this.service = service;
    this.originalError = originalError;

    if (originalError) {
      this.cause = originalError;
    }
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends AppError {
  public readonly configKey?: string;

  constructor(message: string, configKey?: string) {
    super(message, 'CONFIGURATION_ERROR', 500, false);
    this.name = 'ConfigurationError';
    this.configKey = configKey;
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if an error is operational (expected)
 */
export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
}

/**
 * Convert unknown errors to AppError for consistent handling
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 'UNKNOWN_ERROR', 500, false);
  }

  return new AppError(
    typeof error === 'string' ? error : 'An unexpected error occurred',
    'UNKNOWN_ERROR',
    500,
    false
  );
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: unknown) {
  const appError = toAppError(error);

  return {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError instanceof ValidationError && appError.details
        ? { details: appError.details }
        : {}),
      ...(appError instanceof RateLimitError
        ? {
            retryAfter: appError.retryAfter,
            resetAt: appError.resetAt.toISOString(),
          }
        : {}),
    },
  };
}
