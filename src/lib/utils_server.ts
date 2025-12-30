import { execFileSync } from 'node:child_process';

import dns from 'dns';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { RateLimiterMemory } from 'rate-limiter-flexible';

import type { DomainSelectorPair, KeyType } from '@/generated/prisma/client';

import { createDkimRecord, prisma, updateDspTimestamp } from './db';
import { generateWitness } from './generateWitness';
import { logger } from './logger';
import {
  type DnsDkimFetchResult,
  type DspSourceIdentifier,
  kValueToKeyType,
  parseDkimTagList,
} from './utils';

async function refreshKeysFromDns(dsp: DomainSelectorPair) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 1000 * 60 * 60);
  if (!dsp.lastRecordUpdate || dsp.lastRecordUpdate < oneHourAgo) {
    await fetchAndStoreDkimDnsRecord(dsp);
    updateDspTimestamp(dsp, new Date());
  }
}

export type AddResult = {
  already_in_db: boolean;
  added: boolean;
};

export type ProcessResult =
  | {
      success: boolean;
      message: string;
      domain: string;
      selector: string;
      taskId: string;
    }[]
  | { processResultError: string }
  | undefined;
/**
 * @returns true iff a record was added
 */
export async function addDomainSelectorPair(
  domain: string,
  selector: string,
  sourceIdentifier: DspSourceIdentifier
): Promise<AddResult> {
  domain = domain.toLowerCase();
  selector = selector.toLowerCase();

  // check if record exists
  const dsp = await prisma.domainSelectorPair.findFirst({
    where: {
      domain: domain,
      selector: selector,
    },
  });
  if (dsp) {
    await refreshKeysFromDns(dsp);
    return { already_in_db: true, added: false };
  }
  const records = await fetchDkimDnsRecord(domain, selector);
  if (records.length === 0) {
    logger.debug('dns_lookup_empty', { domain, selector });
    return { already_in_db: false, added: false };
  }

  const newDsp = await prisma.domainSelectorPair.create({
    data: {
      domain,
      selector,
      sourceIdentifier,
      lastRecordUpdate: new Date(),
      records: {
        create: [
          ...records.map((record) => ({
            value: record.value,
            firstSeenAt: record.timestamp,
            lastSeenAt: record.timestamp,
            provenanceVerified: false,
            keyType: record.keyType,
            keyData: record.keyDataBase64,
          })),
        ],
      },
    },
    include: {
      records: true,
    },
  });
  newDsp.records.forEach((record) => {
    generateWitness(newDsp, record);
  });
  return { already_in_db: false, added: true };
}

async function runCommand(file: string, args: string[], input: Buffer) {
  try {
    const result = execFileSync(file, args, { input });
    return result.toString();
  } catch (error) {
    logger.error('command_failed', {
      command: `${file} ${args.join(' ')}`,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// return key info if the key is valid, otherwise raise an exception
async function decodeKeyInfo(
  dkimRecordTsv: string
): Promise<{ keyType: KeyType; keyDataBase64: string | null }> {
  const tagValues = parseDkimTagList(dkimRecordTsv);
  const keyType = kValueToKeyType(tagValues['k']);

  if (!Object.prototype.hasOwnProperty.call(tagValues, 'p')) {
    throw new Error('no p= tag found in dkim record');
  }

  const p_base64 = tagValues['p'].trim();
  if (p_base64 === '') {
    // an empty p= tag is allowed and means that the key is revoked
    // see https://datatracker.ietf.org/doc/html/rfc6376#section-3.6.1
    throw new Error('empty p= tag found in dkim record (key revoked)');
  }

  const p_binary = Buffer.from(p_base64, 'base64');
  if (keyType === 'RSA') {
    const asn1parse_output = await runCommand(
      '/usr/bin/env',
      ['openssl', 'asn1parse', '-inform', 'DER'],
      p_binary
    );
    if (!asn1parse_output) {
      throw new Error('openssl asn1parse failed for RSA key');
    }

    // p_base64 may contain non-base64 characters, which are ignored by Buffer.from
    const p_base64_normalized = p_binary.toString('base64');
    return { keyType, keyDataBase64: p_base64_normalized };
  } else {
    return { keyType, keyDataBase64: null };
  }
}

export async function fetchDkimDnsRecord(
  domain: string,
  selector: string
): Promise<DnsDkimFetchResult[]> {
  const resolver = new dns.promises.Resolver({ timeout: 2500 });
  const qname = `${selector}._domainkey.${domain}`;
  let records;

  try {
    records = (await resolver.resolve(qname, 'TXT')).map((record) =>
      record.join('')
    );
  } catch (error) {
    // Fallback to public DNS
    try {
      logger.warn('dns_fallback', {
        qname,
        reason: error instanceof Error ? error.message : String(error),
      });
      resolver.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);
      records = (await resolver.resolve(qname, 'TXT')).map((record) =>
        record.join('')
      );
    } catch (fallbackError) {
      logger.error('dns_lookup_failed', {
        qname,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
      });
      return [];
    }
  }

  const result: DnsDkimFetchResult[] = [];
  for (const record of records) {
    try {
      const { keyType, keyDataBase64 } = await decodeKeyInfo(record);
      result.push({
        selector,
        domain,
        value: record,
        timestamp: new Date(),
        keyType,
        keyDataBase64,
      });
    } catch (error) {
      logger.warn('dkim_decode_failed', {
        domain,
        selector,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Fetches DKIM records from DNS and stores them in the database
 */
export async function fetchAndStoreDkimDnsRecord(dsp: DomainSelectorPair) {
  const dnsRecords = await fetchDkimDnsRecord(dsp.domain, dsp.selector);

  for (const dnsRecord of dnsRecords) {
    let dbRecord = await prisma.dkimRecord.findFirst({
      where: {
        domainSelectorPairId: dsp.id,
        value: dnsRecord.value,
      },
    });

    if (dbRecord) {
      await prisma.dkimRecord.update({
        where: { id: dbRecord.id },
        data: { lastSeenAt: dnsRecord.timestamp },
      });
    } else {
      dbRecord = await createDkimRecord(dsp, dnsRecord);
    }

    if (!dbRecord.provenanceVerified) {
      generateWitness(dsp, dbRecord);
    }
  }
}

export function pubKeyLength(signature: any) {
  const minBytes = Buffer.from(signature || '', 'base64').length;
  const candidates = [128, 256, 512, 1024];
  for (const candidate of candidates) {
    if (minBytes <= candidate) {
      return candidate;
    }
  }
  return minBytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting Helper
// ═══════════════════════════════════════════════════════════════════════════

export async function checkRateLimiter(
  rateLimiter: RateLimiterMemory,
  headers: ReadonlyHeaders,
  consumePoints: number
) {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const clientIp = forwardedFor.split(',')[0];
    await rateLimiter.consume(clientIp, consumePoints);
  }
}
