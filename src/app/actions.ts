'use server';
import { domainToASCII, domainToUnicode } from 'node:url';

import {
  type DkimRecord,
  type DomainSelectorPair,
  Prisma,
} from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

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

  // Simple prefix search for short queries
  if (!asciiQuery.includes('.') && !asciiQuery.includes('-')) {
    const dsps = await prisma.domainSelectorPair.findMany({
      distinct: ['domain'],
      where: {
        domain: { startsWith: asciiQuery, mode: Prisma.QueryMode.insensitive },
      },
      orderBy: { domain: 'asc' },
      take: remainingSlots,
      select: { domain: true },
    });
    return prependExact(dsps.map((d) => d.domain)).map(toUnicode);
  }

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

  return prependExact(sorted).map(toUnicode);
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

  const domainFilter = buildDomainFilter(asciiQuery);

  // On the first page, surface up to EXACT_MATCH_PRIORITY_LIMIT records
  // for the exact-match domain. Without this, short domains like "x.com"
  // are completely missing from results because the first 50 alphabetical
  // substring matches ("101x.com", "1031ex.com", ...) consume the page
  // before their own records ever appear.
  // No insensitive mode on equality: domains are stored lowercased on
  // write and toPunycode normalizes the query, so plain equality uses
  // the btree index instead of an ILIKE seq scan.
  const exactRecords =
    cursorIndex === null
      ? await prisma.dkimRecord.findMany({
          where: {
            domainSelectorPair: { domain: asciiQuery },
          },
          include: { domainSelectorPair: true },
          orderBy: { id: 'asc' },
          take: EXACT_MATCH_PRIORITY_LIMIT,
        })
      : [];

  const remainingSlots = SEARCH_PAGE_SIZE - exactRecords.length;

  // Exclude the exact-match domain from the alphabetical stream on *every*
  // page (not just the first). Without this, any exact-domain records that
  // overflowed the priority cap on page 1 would reappear as duplicates on
  // later pages, and totalCount would no longer match what's actually
  // shown.
  const otherRecords = await prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: {
        ...domainFilter,
        NOT: { domain: asciiQuery },
      },
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
  // signal "load more" when that stream was actually full; otherwise the
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
