/**
 * Standardized API response and request types
 * These types ensure consistent API contracts across all endpoints
 */

/**
 * Base API response wrapper
 * All API responses should follow this structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Paginated API response
 * Used for endpoints that return lists with pagination
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    nextCursor?: number | string | null;
  };
}

/**
 * DKIM record search result
 * Returned by /api/key and /api/key/domain endpoints
 */
export interface DomainSearchResult {
  domain: string;
  selector: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  value: string;
}

/**
 * Request body for adding a domain/selector pair
 */
export interface AddDspRequest {
  domain: string;
  selector: string;
}

/**
 * Response for add DSP operation
 */
export interface AddDspResponse {
  message: { domain: string; selector: string };
  addResult: {
    already_in_db: boolean;
    added: boolean;
  };
}

/**
 * Gmail processing response
 */
export interface GmailProcessResponse {
  messagesProcessed: number;
  messagesTotal?: number;
  addDspResults: AddDspResult[];
  nextPageToken: string | null;
}

/**
 * Result of adding a single DSP from Gmail processing
 */
export interface AddDspResult {
  addResult: { already_in_db: boolean; added: boolean };
  processResult?: ProcessResult;
  domainSelectorPair: { domain: string; selector: string };
  mailTimestamp?: string;
}

/**
 * Process result for email signature processing
 */
export type ProcessResult =
  | Array<{
      success: boolean;
      message: string;
      domain: string;
      selector: string;
      taskId: string;
    }>
  | { processResultError: string }
  | undefined;

/**
 * GCD calculation callback request
 */
export interface GcdCallbackRequest {
  success: boolean;
  result?: string;
  error?: string;
  taskId: string;
  metadata: GcdMetadata;
}

/**
 * Metadata for GCD calculation
 */
export interface GcdMetadata {
  domain: string;
  selector: string;
  dkimSignature1: string;
  dkimSignature2: string;
  headerHash1: string;
  headerHash2: string;
  timestamp1: string;
  timestamp2: string;
  signingAlgorithm: string;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  checks: {
    database: boolean;
    cache?: boolean;
    external?: Record<string, boolean>;
  };
  version?: string;
}

/**
 * Autocomplete response
 */
export interface AutocompleteResponse {
  suggestions: string[];
  query: string;
}

/**
 * Paginated keys search result
 */
export interface PaginatedKeysResult {
  records: DomainSearchResult[];
  nextCursor: number | null;
  total: number;
}

/**
 * JWK Set record
 */
export interface JwkSetRecord {
  id: number;
  x509Certificate: string;
  jwks: string;
  lastUpdated: Date;
  provenanceVerified: boolean | null;
}

/**
 * Batch update response
 */
export interface BatchUpdateResponse {
  updatedRecords: Array<{
    id: number;
    domain: string;
    selector: string;
  }>;
  addedAlternatives: Array<{
    domain: string;
    selector: string;
  }>;
  timestamp: string;
}

/**
 * Email signature data
 */
export interface EmailSignatureData {
  domain: string;
  selector: string;
  headerHash: string;
  headerHashV2?: string;
  dkimSignature: string;
  timestamp?: Date;
  signingAlgorithm: string;
  canonInfo: string;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  retryAfter?: number;
  resetAt?: string;
}

/**
 * Request with authentication token
 */
export interface AuthenticatedRequest {
  accessToken: string;
  user?: {
    email: string;
    name?: string;
  };
}

/**
 * Rate limit info headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: string;
}

/**
 * Query parameters for key search
 */
export interface KeySearchParams {
  domain: string;
  selector?: string;
}

/**
 * Query parameters for Gmail processing
 */
export interface GmailQueryParams {
  pageToken?: string;
  gmailQuery?: string;
  maxResults?: number;
}

/**
 * Query parameters for batch update
 */
export interface BatchUpdateParams {
  batch_size?: number;
}
