import { PrismaPg } from '@prisma/adapter-pg';
import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';

import {
  type DkimRecord,
  type DomainSelectorPair,
  Prisma,
  PrismaClient,
} from '@/generated/prisma/client';

import { logger } from './logger';
import { DnsDkimFetchResult, fetchJsonWebKeySet, fetchx509Cert } from './utils';

// In process Cache configuration (LRU cache)
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 1000; // Maximum 1000 entries

// Create LRU cache instances
const domainCache = new LRUCache<string, RecordWithSelector[]>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL,
});

const domainSelectorCache = new LRUCache<string, RecordWithSelector[]>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL,
});

// Cache for DomainSelectorPair IDs to avoid repeated lookups
const DSP_ID_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
const dspIdCache = new LRUCache<string, number>({
  max: CACHE_MAX_SIZE,
  ttl: DSP_ID_CACHE_TTL,
});

const createPrismaClient = () => {
  // Create a pg Pool with optimized connection settings
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Max connections
    idleTimeoutMillis: 30000, // 30 seconds idle timeout
    connectionTimeoutMillis: 10000, // 10 seconds connection timeout
  });

  // Create the Prisma adapter with the pool
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
};

declare global {
  var prismaClient: undefined | ReturnType<typeof createPrismaClient>;
}
export const prisma = globalThis.prismaClient ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClient = prisma;
}

export type RecordWithSelector = DkimRecord & {
  domainSelectorPair: DomainSelectorPair;
};

export async function findRecords(
  domainQuery: string
): Promise<RecordWithSelector[]> {
  return await prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: {
        OR: [
          {
            domain: {
              equals: domainQuery,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            domain: {
              endsWith: '.' + domainQuery,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      },
      value: {
        not: {
          equals: 'p=',
        },
      },
    },
    include: {
      domainSelectorPair: true,
    },
  });
}

export function dspToString(dsp: DomainSelectorPair): string {
  return `#${dsp.id}, ${dsp.domain}, ${dsp.selector}`;
}

export function recordToString(record: DkimRecord): string {
  const value = record.value;
  const maxLen = 50;
  const valueTruncated =
    value.length > maxLen ? value.slice(0, maxLen - 1) + '…' : value;
  return `#${record.id}, "${valueTruncated}"`;
}

export async function updateDspTimestamp(
  dsp: DomainSelectorPair,
  timestamp: Date
) {
  const updatedSelector = await prisma.domainSelectorPair.update({
    where: {
      id: dsp.id,
    },
    data: {
      lastRecordUpdate: timestamp,
    },
  });

  clearRecordsCache(dsp.domain, dsp.selector);
}

export async function createDkimRecord(
  dsp: DomainSelectorPair,
  dkimDsnRecord: DnsDkimFetchResult
) {
  const dkimRecord = await prisma.dkimRecord.create({
    data: {
      domainSelectorPairId: dsp.id,
      value: dkimDsnRecord.value,
      firstSeenAt: dkimDsnRecord.timestamp,
      lastSeenAt: dkimDsnRecord.timestamp,
      provenanceVerified: false,
      keyType: dkimDsnRecord.keyType,
      keyData: dkimDsnRecord.keyDataBase64,
    },
  });

  clearRecordsCache(dsp.domain, dsp.selector);

  logger.info('dkim_record_created', {
    recordId: dkimRecord.id,
    domain: dsp.domain,
    selector: dsp.selector,
    keyType: dkimDsnRecord.keyType,
  });

  return dkimRecord;
}

export async function getLastJWKeySet() {
  try {
    const lastJwtKey = await prisma.jsonWebKeySets.findFirst({
      orderBy: {
        lastUpdated: 'desc',
      },
    });

    return lastJwtKey;
  } catch (error) {
    logger.error('jwk_fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateJWKeySet() {
  try {
    const lastJWKeySet = await getLastJWKeySet();
    const latestx509Cert = await fetchx509Cert();
    const latestJsonWebKeySet = await fetchJsonWebKeySet();
    if (latestx509Cert == '' || latestJsonWebKeySet == '') {
      logger.error('jwk_update_failed', { reason: 'empty_keys' });
      return;
    }
    if (lastJWKeySet?.x509Certificate != latestx509Cert) {
      return await prisma.jsonWebKeySets.create({
        data: {
          jwks: latestJsonWebKeySet,
          x509Certificate: latestx509Cert,
          provenanceVerified: false,
        },
      });
    } else {
      return await prisma.jsonWebKeySets.update({
        where: {
          id: lastJWKeySet.id,
        },
        data: {
          lastUpdated: new Date(),
        },
      });
    }
  } catch (error) {
    logger.error('jwk_update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getJWKeySetRecord() {
  const jwkSetRecord = await prisma.jsonWebKeySets.findMany();
  return jwkSetRecord;
}

// Helper function to generate cache keys
function generateCacheKey(domain: string, selector?: string): string {
  return selector ? `${domain}:${selector}` : domain;
}

const inFlightRequests = new Map<string, Promise<RecordWithSelector[]>>();

export async function findRecordsWithCache(
  domain: string,
  selector?: string
): Promise<RecordWithSelector[]> {
  // Normalize inputs to lowercase
  const domainNorm = domain.toLowerCase();
  const selectorNorm = selector?.toLowerCase();

  const cacheKey = generateCacheKey(domainNorm, selectorNorm);
  const cache = selector ? domainSelectorCache : domainCache;

  // Try to get from cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // De-duplicate concurrent misses
  const inflight = inFlightRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  // Cache miss: fetch from database

  const p = (async () => {
    // Minimal timing to avoid console overhead in hot path

    if (selectorNorm) {
      // STEP 1: Try in-memory DSP id cache first
      const dspIdKey = generateCacheKey(domainNorm, selectorNorm);
      let dspId = dspIdCache.get(dspIdKey);
      if (!dspId) {
        const dsp = await prisma.domainSelectorPair.findFirst({
          where: { domain: domainNorm, selector: selectorNorm },
          select: { id: true },
        });
        if (!dsp) {
          cache.set(cacheKey, []);
          return [];
        }
        dspId = dsp.id;
        dspIdCache.set(dspIdKey, dspId);
      }

      // STEP 2: Get DkimRecords by ID
      const dkimRecords = await prisma.dkimRecord.findMany({
        where: { domainSelectorPairId: dspId },
        select: { firstSeenAt: true, lastSeenAt: true, value: true },
      });

      // Filter and combine (use normalized domain/selector)
      const filtered = dkimRecords.filter((record) => record.value !== 'p=');
      const result = filtered.map((record) => ({
        ...record,
        domainSelectorPair: { domain: domainNorm, selector: selectorNorm },
      })) as unknown as RecordWithSelector[];

      cache.set(cacheKey, result);
      return result;
    } else {
      // Domain-only path (same detailed logging)
      const dsps = await prisma.domainSelectorPair.findMany({
        where: { domain: domainNorm },
        select: { id: true, domain: true, selector: true },
      });

      if (dsps.length === 0) {
        cache.set(cacheKey, []);
        return [];
      }

      const dkimRecords = await prisma.dkimRecord.findMany({
        where: { domainSelectorPairId: { in: dsps.map((dsp) => dsp.id) } },
        select: {
          domainSelectorPairId: true,
          firstSeenAt: true,
          lastSeenAt: true,
          value: true,
        },
      });

      const dspMap = new Map(dsps.map((dsp) => [dsp.id, dsp]));
      const filtered = dkimRecords.filter((record) => record.value !== 'p=');
      const result = filtered.map((record) => {
        const dsp = dspMap.get(record.domainSelectorPairId)!;
        return {
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          value: record.value,
          domainSelectorPair: { domain: dsp.domain, selector: dsp.selector },
        };
      }) as unknown as RecordWithSelector[];

      cache.set(cacheKey, result);
      return result;
    }
  })();

  inFlightRequests.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

// Function to clear cache when data is updated
export function clearRecordsCache(domain?: string, selector?: string) {
  if (domain && selector) {
    const domainNorm = domain.toLowerCase();
    const selectorNorm = selector.toLowerCase();
    const cacheKey = generateCacheKey(domainNorm, selectorNorm);
    domainSelectorCache.delete(cacheKey);
    domainCache.delete(domainNorm);
    dspIdCache.delete(cacheKey);
  } else if (domain) {
    const domainNorm = domain.toLowerCase();
    domainCache.delete(domainNorm);
    for (const key of domainSelectorCache.keys()) {
      if (key.startsWith(domainNorm + ':')) {
        domainSelectorCache.delete(key);
      }
    }
    for (const key of dspIdCache.keys()) {
      if (key.startsWith(domainNorm + ':')) {
        dspIdCache.delete(key);
      }
    }
  } else {
    domainCache.clear();
    domainSelectorCache.clear();
    dspIdCache.clear();
  }
}
