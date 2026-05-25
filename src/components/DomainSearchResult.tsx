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
  onLoadingChange?: (loading: boolean) => void;
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

export function DomainSearchResults({
  domainQuery,
  filters = {},
  onLoadingChange,
}: Props) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadingMoreRef = useRef(false);
  // Abort-on-new model: each search bumps requestIdRef. A response only
  // updates state if its id still matches; otherwise it was superseded
  // by a newer query and is silently dropped. Loading is true iff the
  // most recent search hasn't completed yet — older in-flight fetches
  // don't own the loading flag, so they can't get it stuck.
  //
  // The previous "queue-latest" implementation kept a separate
  // pendingQueryRef + inFlightRef + a while loop; it had an edge case
  // where rapid query changes left the loading state stuck on (REG-712).
  // Server actions still can't be aborted client-side, so older fetches
  // continue to run on the server; they just have no client-side effect.
  const requestIdRef = useRef(0);

  const runSearch = useCallback(async (query: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const response = await searchDomain(query, null);
      if (requestId !== requestIdRef.current) return;
      // Guard against the server returning undefined (e.g. dev-mode
      // stale-server-action errors); keep data null in that case.
      setData(response ?? null);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError('Failed to load search results');
      console.error('Search error:', err);
    } finally {
      // Only the latest request owns the loading flag. A stale response
      // landing late must not flip loading off while a newer search is
      // still pending.
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadRecords = useCallback(() => {
    if (!domainQuery) {
      requestIdRef.current += 1;
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    runSearch(domainQuery);
  }, [domainQuery, runSearch]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Mirror the committed-search loading state up to the parent so the
  // SearchAndFilterSection magnifier button can show a spinner while the
  // user-initiated search is in flight.
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

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
          // Cursor pages skip the count query; preserve the page-1 value.
          totalCount: response.totalCount ?? prev.totalCount,
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

  if (loading || (!data && !error)) {
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
