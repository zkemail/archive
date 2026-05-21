'use server';
import { domainToASCII, domainToUnicode } from 'node:url';

import { LRUCache } from 'lru-cache';

import {
  type DkimRecord,
  type DomainSelectorPair,
  Prisma,
} from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

// LRU caches for the user-facing hot paths (autocomplete + searchDomain
// count). Most queries are repeats: typing-and-deleting the same prefix,
// popular domains, etc. Cache hit returns in <1ms and obviates the
// cross-cloud round trip + ILIKE seq scan entirely.
//
// Staleness window is bounded by TTL (5 min). New records added between
// invalidations may be missing from suggestions and the count may be
// off, both acceptable for autocomplete/count cosmetics. No explicit
// invalidation from write paths (kept simple).
const HOT_PATH_CACHE_TTL = 5 * 60 * 1000;
const HOT_PATH_CACHE_MAX = 500;

const autocompleteCache = new LRUCache<string, string[]>({
  max: HOT_PATH_CACHE_MAX,
  ttl: HOT_PATH_CACHE_TTL,
});

const searchCountCache = new LRUCache<string, number>({
  max: HOT_PATH_CACHE_MAX,
  ttl: HOT_PATH_CACHE_TTL,
});

// DKIM domains are stored in Punycode (xn--…) form in the DB, so any
// IDN input must be encoded before lookup. ASCII queries pass through
// unchanged. Falls back to the raw query when domainToASCII rejects the
// input so the DB call still runs (and returns no rows) rather than
// throwing on partially typed input.
function toPunycode(query: string): string {
  return domainToASCII(query) || query;
}

// Inverse of toPunycode for display: render "пример.рф" in suggestions
// and results instead of the raw "xn--e1afmkfd.xn--p1ai" form.
function toUnicode(domain: string): string {
  return domainToUnicode(domain) || domain;
}

// Helper: Build domain search filter with subdomain/variant matching
function buildDomainFilter(query: string): Prisma.DomainSelectorPairWhereInput {
  const modifiedQuery = query.replace(/\./g, '-');
  const modifiedQuery2 = query.replace(/-/g, '.');

  return {
    OR: [
      { domain: { contains: query, mode: Prisma.QueryMode.insensitive } },
      {
        domain: { contains: modifiedQuery, mode: Prisma.QueryMode.insensitive },
      },
      {
        domain: {
          contains: modifiedQuery2,
          mode: Prisma.QueryMode.insensitive,
        },
      },
    ],
  };
}

export type AutocompleteResults = string[];

const AUTOCOMPLETE_LIMIT = 8;

export async function autocomplete(query: string): Promise<string[]> {
  if (!query) return [];

  // Punycode-encode the query so IDN inputs ("пример.рф") match the
  // ASCII form stored in the DB.
  const asciiQuery = toPunycode(query);

  // Cache hit fast-path. Cached value is the final Unicode-rendered
  // suggestion list, so a hit obviates both the DB call and the
  // post-processing.
  const cached = autocompleteCache.get(asciiQuery);
  if (cached !== undefined) return cached;

  // Always look up the exact match first. Without this, short domains
  // like "x.com" get buried under the top-N alphabetical substring matches
  // ("101x.com", "1031ex.com", ...) and never appear in the dropdown even
  // though the API returns them.
  //
  // No insensitive mode: domains are stored lowercased on write (see
  // utilsServer.ts addDomainSelectorPair and db.ts findRecordsWithCache),
  // and toPunycode normalizes the query to lowercase too. Plain equality
  // uses the (domain, selector) btree index; ILIKE does not.
  const exactMatch = await prisma.domainSelectorPair.findFirst({
    where: { domain: asciiQuery },
    select: { domain: true },
  });

  const remainingSlots = exactMatch
    ? AUTOCOMPLETE_LIMIT - 1
    : AUTOCOMPLETE_LIMIT;

  const prependExact = (results: string[]): string[] => {
    if (!exactMatch) return results;
    const lowered = exactMatch.domain.toLowerCase();
    const deduped = results.filter((d) => d.toLowerCase() !== lowered);
    return [exactMatch.domain, ...deduped].slice(0, AUTOCOMPLETE_LIMIT);
  };

  let result: string[];
  if (!asciiQuery.includes('.') && !asciiQuery.includes('-')) {
    // Simple prefix search for short queries
    const dsps = await prisma.domainSelectorPair.findMany({
      distinct: ['domain'],
      where: {
        domain: { startsWith: asciiQuery, mode: Prisma.QueryMode.insensitive },
      },
      orderBy: { domain: 'asc' },
      take: remainingSlots,
      select: { domain: true },
    });
    result = prependExact(dsps.map((d) => d.domain)).map(toUnicode);
  } else {
    // Multi-strategy search for queries with dots/dashes
    const dsps = await prisma.domainSelectorPair.findMany({
      distinct: ['domain'],
      where: buildDomainFilter(asciiQuery),
      orderBy: { domain: 'asc' },
      take: remainingSlots,
      select: { domain: true },
    });

    // Prioritize results that start with the query
    const sorted = dsps
      .map((d) => d.domain)
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(asciiQuery.toLowerCase());
        const bStarts = b.toLowerCase().startsWith(asciiQuery.toLowerCase());
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });

    result = prependExact(sorted).map(toUnicode);
  }

  autocompleteCache.set(asciiQuery, result);
  return result;
}

export type RecordWithSelector = DkimRecord & {
  domainSelectorPair: DomainSelectorPair;
};

// Frontend-compatible search result type
export type SearchResult = {
  id: number;
  domain: string;
  selector: string;
  firstActive: string;
  lastActive: string;
  value: string;
  origin: string;
};

export type SearchResponse = {
  searchResults: SearchResult[];
  nextCursor: number | null;
  // Optional because cursor (load-more) pages skip the count query as
  // a perf optimization; the count is identical across pages for the
  // same query, so the client carries forward the page-1 value.
  totalCount?: number;
};

export type SearchFilters = {
  status?: 'all' | 'active' | 'expired';
  fromDate?: string;
  toDate?: string;
};

// Transform DB record to frontend format
function transformToSearchResult(record: RecordWithSelector): SearchResult {
  return {
    id: record.id,
    domain: toUnicode(record.domainSelectorPair.domain),
    selector: record.domainSelectorPair.selector,
    firstActive: record.firstSeenAt.toISOString(),
    lastActive:
      record.lastSeenAt?.toISOString() ?? record.firstSeenAt.toISOString(),
    value: record.value,
    origin:
      record.source ?? record.domainSelectorPair.sourceIdentifier ?? 'Unknown',
  };
}

const SEARCH_PAGE_SIZE = 50;
const EXACT_MATCH_PRIORITY_LIMIT = 10;

// Main search function for frontend - returns all data (filtering done client-side)
export async function searchDomain(
  domainQuery: string,
  cursorIndex: number | null = null
): Promise<SearchResponse> {
  if (!domainQuery) {
    return { searchResults: [], nextCursor: null, totalCount: 0 };
  }

  // Encode IDN inputs to Punycode before any DB lookup. ASCII queries
  // pass through unchanged.
  const asciiQuery = toPunycode(domainQuery);
  const isFirstPage = cursorIndex === null;
  const domainFilter = buildDomainFilter(asciiQuery);

  // All three queries are independent on page 1 and run in parallel,
  // saving 2 cross-cloud round trips (~270 ms baseline) and overlapping
  // DB work.
  //
  // otherRecords always fetches up to SEARCH_PAGE_SIZE rather than
  // (PAGE_SIZE - exactRecords.length); we slice the combined list to
  // SEARCH_PAGE_SIZE below. This trades a handful of possibly-wasted
  // rows on page 1 (when the domain has many exact-match records) for
  // breaking the exactRecords -> otherRecords dependency. The seq-scan
  // cost dominates the small LIMIT difference anyway.
  //
  // totalCount only runs on page 1 because the value doesn't change
  // across cursor pages for the same query; the client preserves the
  // page-1 value when loading more. Skipping count on cursor pages saves
  // a full ILIKE substring scan per scroll.
  //
  // exactRecords: surface up to EXACT_MATCH_PRIORITY_LIMIT records for
  // the exact-match domain so short canonical domains like "x.com"
  // aren't buried under alphabetical substring matches.
  //
  // otherRecords: exclude the exact-match domain on every page (not
  // just page 1), otherwise exact-domain overflow beyond the priority
  // cap would reappear as duplicates on later pages.
  const exactRecordsPromise = isFirstPage
    ? prisma.dkimRecord.findMany({
        where: {
          domainSelectorPair: { domain: asciiQuery },
        },
        include: { domainSelectorPair: true },
        orderBy: { id: 'asc' },
        take: EXACT_MATCH_PRIORITY_LIMIT,
      })
    : Promise.resolve([]);

  const otherRecordsPromise = prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: {
        ...domainFilter,
        NOT: { domain: asciiQuery },
      },
    },
    include: { domainSelectorPair: true },
    orderBy: { domainSelectorPair: { domain: 'asc' } },
    take: SEARCH_PAGE_SIZE,
    ...(cursorIndex ? { cursor: { id: cursorIndex }, skip: 1 } : {}),
  });

  // Count is identical across pages for the same query, so we cache it.
  // On a cache hit, page-1 still gets a value without paying the full
  // substring scan; on miss, we cache the result.
  const cachedCount = isFirstPage
    ? searchCountCache.get(asciiQuery)
    : undefined;
  const totalCountPromise = isFirstPage
    ? (cachedCount ??
      prisma.dkimRecord.count({
        where: { domainSelectorPair: domainFilter },
      }))
    : Promise.resolve(undefined);

  const [exactRecords, otherRecords, totalCount] = await Promise.all([
    exactRecordsPromise,
    otherRecordsPromise,
    totalCountPromise,
  ]);

  // Populate the count cache after a miss. (cachedCount was undefined,
  // so we just computed totalCount fresh.)
  if (isFirstPage && cachedCount === undefined && totalCount !== undefined) {
    searchCountCache.set(asciiQuery, totalCount);
  }

  const records = [...exactRecords, ...otherRecords].slice(0, SEARCH_PAGE_SIZE);

  // Filter for records with public key (p= tag present and not empty)
  const filteredRecords = records.filter((r) => {
    const match = r.value.match(/p=([^;]*)/);
    return match && match[1] && match[1].trim().length > 0;
  });

  const searchResults = filteredRecords.map(transformToSearchResult);

  // Signal "load more" only when otherRecords filled the page; otherwise
  // the client wastes a roundtrip fetching an empty next page.
  const nextCursor =
    otherRecords.length === SEARCH_PAGE_SIZE
      ? otherRecords[otherRecords.length - 1].id
      : null;

  return { searchResults, nextCursor, totalCount };
}
