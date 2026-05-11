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

export async function autocomplete(query: string): Promise<string[]> {
  if (!query) return [];

  // Simple prefix search for short queries
  if (!query.includes('.') && !query.includes('-')) {
    const dsps = await prisma.domainSelectorPair.findMany({
      distinct: ['domain'],
      where: {
        domain: { startsWith: query, mode: Prisma.QueryMode.insensitive },
      },
      orderBy: { domain: 'asc' },
      take: 8,
      select: { domain: true },
    });
    return dsps.map((d) => d.domain);
  }

  // Multi-strategy search for queries with dots/dashes
  const dsps = await prisma.domainSelectorPair.findMany({
    distinct: ['domain'],
    where: buildDomainFilter(query),
    orderBy: { domain: 'asc' },
    take: 8,
    select: { domain: true },
  });

  // Prioritize results that start with the query
  return dsps
    .map((d) => d.domain)
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(query.toLowerCase());
      const bStarts = b.toLowerCase().startsWith(query.toLowerCase());
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.localeCompare(b);
    });
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

// Main search function for frontend - returns all data (filtering done client-side)
export async function searchDomain(
  domainQuery: string,
  cursorIndex: number | null = null
): Promise<SearchResponse> {
  if (!domainQuery) {
    return { searchResults: [], nextCursor: null, totalCount: 0 };
  }

  const domainFilter = buildDomainFilter(domainQuery);

  const records = await prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: domainFilter,
    },
    include: { domainSelectorPair: true },
    orderBy: { domainSelectorPair: { domain: 'asc' } },
    take: SEARCH_PAGE_SIZE,
    ...(cursorIndex ? { cursor: { id: cursorIndex }, skip: 1 } : {}),
  });

  // Filter for records with public key (p= tag present and not empty)
  const filteredRecords = records.filter((r) => {
    const match = r.value.match(/p=([^;]*)/);
    return match && match[1] && match[1].trim().length > 0;
  });

  const searchResults = filteredRecords.map(transformToSearchResult);
  // Only signal "load more" when the page was actually full — otherwise the
  // client wastes a roundtrip fetching an empty next page.
  const nextCursor =
    records.length === SEARCH_PAGE_SIZE ? records[records.length - 1].id : null;

  // Get total count
  const totalCount = await prisma.dkimRecord.count({
    where: {
      domainSelectorPair: domainFilter,
    },
  });

  return { searchResults, nextCursor, totalCount };
}
