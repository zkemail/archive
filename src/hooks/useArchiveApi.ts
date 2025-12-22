'use client';

import { useCallback, useState } from 'react';

import type {
  AddDspResponse,
  DomainSearchResult,
  GmailProcessResponse,
  JwkSetRecord,
} from '@/types/api';

/**
 * Error type for API calls
 */
interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Hook state for async operations
 */
interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Custom hook for interacting with Archive API endpoints
 * Provides type-safe methods for all API operations
 */
export function useArchiveApi() {
  const [searchState, setSearchState] = useState<
    AsyncState<DomainSearchResult[]>
  >({
    data: null,
    loading: false,
    error: null,
  });

  const [addDspState, setAddDspState] = useState<AsyncState<AddDspResponse>>({
    data: null,
    loading: false,
    error: null,
  });

  /**
   * Search for DKIM records by domain
   * Uses the cached endpoint for better performance
   */
  const searchDomain = useCallback(
    async (
      domain: string,
      selector?: string
    ): Promise<DomainSearchResult[]> => {
      setSearchState({ data: null, loading: true, error: null });

      try {
        const params = new URLSearchParams({ domain });
        if (selector) {
          params.set('selector', selector);
        }

        const response = await fetch(`/api/key/domain?${params.toString()}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw {
            message: errorData.error || 'Search failed',
            code: errorData.code,
            status: response.status,
          };
        }

        const data: DomainSearchResult[] = await response.json();
        setSearchState({ data, loading: false, error: null });
        return data;
      } catch (error) {
        const apiError: ApiError =
          error instanceof Error
            ? { message: error.message }
            : (error as ApiError);

        setSearchState({ data: null, loading: false, error: apiError });
        throw error;
      }
    },
    []
  );

  /**
   * Add a domain/selector pair to the archive
   */
  const addDsp = useCallback(
    async (domain: string, selector: string): Promise<AddDspResponse> => {
      setAddDspState({ data: null, loading: true, error: null });

      try {
        const response = await fetch('/api/dsp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, selector }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw {
            message: errorData.error || 'Failed to add domain/selector pair',
            code: errorData.code,
            status: response.status,
          };
        }

        const data: AddDspResponse = await response.json();
        setAddDspState({ data, loading: false, error: null });
        return data;
      } catch (error) {
        const apiError: ApiError =
          error instanceof Error
            ? { message: error.message }
            : (error as ApiError);

        setAddDspState({ data: null, loading: false, error: apiError });
        throw error;
      }
    },
    []
  );

  /**
   * Search for DKIM records (non-cached endpoint)
   */
  const searchKey = useCallback(
    async (
      domain: string,
      selector?: string
    ): Promise<DomainSearchResult[]> => {
      const params = new URLSearchParams({ domain });
      if (selector) {
        params.set('selector', selector);
      }

      const response = await fetch(`/api/key?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Search failed');
      }

      return response.json();
    },
    []
  );

  /**
   * Get JWK set records
   */
  const getJwkSet = useCallback(async (): Promise<JwkSetRecord[]> => {
    const response = await fetch('/api/jwk_set');

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch JWK set');
    }

    return response.json();
  }, []);

  /**
   * Process Gmail emails (requires authentication)
   */
  const processGmail = useCallback(
    async (
      pageToken?: string,
      gmailQuery?: string
    ): Promise<GmailProcessResponse> => {
      const params = new URLSearchParams();
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      if (gmailQuery) {
        params.set('gmailQuery', gmailQuery);
      }

      const url = `/api/gmail${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Gmail processing failed');
      }

      return response.json();
    },
    []
  );

  /**
   * Check API health status
   */
  const checkHealth = useCallback(async (): Promise<{
    status: string;
    checks: Record<string, boolean>;
  }> => {
    const response = await fetch('/api/health');

    if (!response.ok && response.status !== 503) {
      throw new Error('Health check failed');
    }

    return response.json();
  }, []);

  return {
    // Search operations
    searchDomain,
    searchKey,
    searchState,

    // Add DSP operations
    addDsp,
    addDspState,

    // Other operations
    getJwkSet,
    processGmail,
    checkHealth,
  };
}

export default useArchiveApi;
