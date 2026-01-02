'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  searchDomain,
  type SearchFilters,
  type SearchResponse,
  type SearchResult,
} from '@/app/actions';
import SelectorDetails from '@/app/search/SelectorDetails';

interface Props {
  domainQuery: string | undefined;
  filters?: SearchFilters;
}

// Check if a record is expired (last seen > 365 days ago)
function isRecordExpired(lastActive: string): boolean {
  const lastActiveDate = new Date(lastActive);
  const now = new Date();
  const daysDiff =
    (now.getTime() - lastActiveDate.getTime()) / (1000 * 3600 * 24);
  return daysDiff > 365;
}

function applyFilters(
  results: SearchResult[],
  filters: SearchFilters
): SearchResult[] {
  return results.filter((record) => {
    // Status filter
    if (filters.status && filters.status !== 'all') {
      const expired = isRecordExpired(record.lastActive);
      if (filters.status === 'expired' && !expired) return false;
      if (filters.status === 'active' && expired) return false;
    }

    // From date filter - show records last seen ON or AFTER fromDate
    if (filters.fromDate) {
      const fromDate = new Date(filters.fromDate);
      const lastActive = new Date(record.lastActive);
      if (lastActive < fromDate) return false;
    }

    // To date filter - show records first seen ON or BEFORE toDate
    if (filters.toDate) {
      const toDate = new Date(filters.toDate);
      const firstActive = new Date(record.firstActive);
      if (firstActive > toDate) return false;
    }

    return true;
  });
}

export function DomainSearchResults({ domainQuery, filters = {} }: Props) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Use refs to prevent race conditions
  const loadingMoreRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadRecords = useCallback(async () => {
    if (!domainQuery) {
      setData(null);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const response = await searchDomain(domainQuery, null);
      setData(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Failed to load search results');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [domainQuery]);

  useEffect(() => {
    loadRecords();
    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadRecords]);

  const loadMore = useCallback(async () => {
    // Use ref to prevent multiple concurrent calls
    if (!domainQuery || !data?.nextCursor || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const response = await searchDomain(domainQuery, data.nextCursor);
      setData((prev) => {
        if (!prev) return response;
        // Deduplicate results by id
        const existingIds = new Set(prev.searchResults.map((r) => r.id));
        const newResults = response.searchResults.filter(
          (r) => !existingIds.has(r.id)
        );
        return {
          ...response,
          searchResults: [...prev.searchResults, ...newResults],
        };
      });
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [domainQuery, data?.nextCursor]);

  // Client-side filtering with useMemo
  const filteredData = useMemo<SearchResponse | null>(() => {
    if (!data) return null;

    const filteredResults = applyFilters(data.searchResults, filters);
    return {
      ...data,
      searchResults: filteredResults,
    };
  }, [data, filters]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !data?.nextCursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMoreRef.current) {
          loadMore();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data?.nextCursor, loadMore]);

  if (!domainQuery) {
    return <div className='text-secondary'>Enter a domain to search</div>;
  }

  if (loading && !data) {
    return (
      <div className='flex items-center justify-center py-8'>
        <div className='text-secondary'>Loading...</div>
      </div>
    );
  }

  if (error) {
    return <div className='text-red-500'>{error}</div>;
  }

  if (!filteredData || filteredData.searchResults.length === 0) {
    return (
      <div className='text-secondary'>
        No results found for &quot;{domainQuery}&quot;
      </div>
    );
  }

  return (
    <div className='w-full'>
      <SelectorDetails data={filteredData} />
      {data?.nextCursor && (
        <div ref={sentinelRef} className='flex justify-center py-4'>
          {loadingMore && (
            <div className='text-sm text-secondary'>Loading more...</div>
          )}
        </div>
      )}
    </div>
  );
}
