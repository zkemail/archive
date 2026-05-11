'use server';
import {
  type DkimRecord,
  type DomainSelectorPair,
  Prisma,
} from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

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

  // Always look up the exact match first. Without this, short domains
  // like "x.com" get buried under the top-N alphabetical substring matches
  // ("101x.com", "1031ex.com", ...) and never appear in the dropdown even
  // though the API returns them.
  const exactMatch = await prisma.domainSelectorPair.findFirst({
    where: {
      domain: { equals: query, mode: Prisma.QueryMode.insensitive },
    },
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

  // Simple prefix search for short queries
  if (!query.includes('.') && !query.includes('-')) {
    const dsps = await prisma.domainSelectorPair.findMany({
      distinct: ['domain'],
      where: {
        domain: { startsWith: query, mode: Prisma.QueryMode.insensitive },
      },
      orderBy: { domain: 'asc' },
      take: remainingSlots,
      select: { domain: true },
    });
    return prependExact(dsps.map((d) => d.domain));
  }

  // Multi-strategy search for queries with dots/dashes
  const dsps = await prisma.domainSelectorPair.findMany({
    distinct: ['domain'],
    where: buildDomainFilter(query),
    orderBy: { domain: 'asc' },
    take: remainingSlots,
    select: { domain: true },
  });

  // Prioritize results that start with the query
  const sorted = dsps
    .map((d) => d.domain)
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(query.toLowerCase());
      const bStarts = b.toLowerCase().startsWith(query.toLowerCase());
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.localeCompare(b);
    });

  return prependExact(sorted);
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
  provenanceVerified: boolean;
};

export type SearchResponse = {
  searchResults: SearchResult[];
  nextCursor: number | null;
  totalCount: number;
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
    domain: record.domainSelectorPair.domain,
    selector: record.domainSelectorPair.selector,
    firstActive: record.firstSeenAt.toISOString(),
    lastActive:
      record.lastSeenAt?.toISOString() ?? record.firstSeenAt.toISOString(),
    value: record.value,
    origin:
      record.source ?? record.domainSelectorPair.sourceIdentifier ?? 'Unknown',
    provenanceVerified: record.provenanceVerified ?? false,
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

  const domainFilter = buildDomainFilter(domainQuery);

  // On the first page, surface up to EXACT_MATCH_PRIORITY_LIMIT records
  // for the exact-match domain. Without this, short domains like "x.com"
  // are completely missing from results because the first 50 alphabetical
  // substring matches ("101x.com", "1031ex.com", ...) consume the page
  // before their own records ever appear.
  const exactRecords =
    cursorIndex === null
      ? await prisma.dkimRecord.findMany({
          where: {
            domainSelectorPair: {
              domain: {
                equals: domainQuery,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
          include: { domainSelectorPair: true },
          orderBy: { id: 'asc' },
          take: EXACT_MATCH_PRIORITY_LIMIT,
        })
      : [];

  const exactIds = exactRecords.map((r) => r.id);
  const remainingSlots = SEARCH_PAGE_SIZE - exactRecords.length;

  const otherRecords = await prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: domainFilter,
      ...(exactIds.length > 0 ? { id: { notIn: exactIds } } : {}),
    },
    include: { domainSelectorPair: true },
    orderBy: { domainSelectorPair: { domain: 'asc' } },
    take: remainingSlots,
    ...(cursorIndex ? { cursor: { id: cursorIndex }, skip: 1 } : {}),
  });

  const records = [...exactRecords, ...otherRecords];

  // Filter for records with public key (p= tag present and not empty)
  const filteredRecords = records.filter((r) => {
    const match = r.value.match(/p=([^;]*)/);
    return match && match[1] && match[1].trim().length > 0;
  });

  const searchResults = filteredRecords.map(transformToSearchResult);
  // Pagination cursor tracks the alphabetical (non-exact) stream. Only
  // signal "load more" when that stream was actually full — otherwise the
  // client wastes a roundtrip fetching an empty next page.
  const nextCursor =
    otherRecords.length === remainingSlots && remainingSlots > 0
      ? otherRecords[otherRecords.length - 1].id
      : null;

  // Get total count
  const totalCount = await prisma.dkimRecord.count({
    where: {
      domainSelectorPair: domainFilter,
    },
  });

  return { searchResults, nextCursor, totalCount };
}
