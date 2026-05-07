import { execFileSync } from 'node:child_process';

import * as crypto from 'crypto';
import dns from 'dns';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { RateLimiterMemory } from 'rate-limiter-flexible';

import type { DomainSelectorPair, KeyType } from '@/generated/prisma/client';

import { createDkimRecord, prisma, updateDspTimestamp } from './db';
import { logger } from './logger';
import {
  type DnsDkimFetchResult,
  type DspSourceIdentifier,
  kValueToKeyType,
  parseDkimTagList,
} from './utils';

export const DIGEST_INFO: Record<string, Buffer> = {
  'rsa-sha1': Buffer.from('3021300906052b0e03021a05000414', 'hex'),
  'rsa-sha256': Buffer.from('3031300d060960864801650304020105000420', 'hex'),
  'rsa-sha512': Buffer.from('3051300d060960864801650304020305000440', 'hex'),
};

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

  await prisma.domainSelectorPair.create({
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

export function getClientIp(headers: ReadonlyHeaders): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback: use a global key to still enforce rate limiting
  return 'unknown-ip';
}

export async function checkRateLimiter(
  rateLimiter: RateLimiterMemory,
  headers: ReadonlyHeaders,
  consumePoints: number
) {
  const clientIp = getClientIp(headers);
  await rateLimiter.consume(clientIp, consumePoints);
}

// Function to parse DKIM header into [[header_name, header_value]] format
// Preserves all whitespace and line endings for simple canonicalization
// we use double array [[]] here to make the outputs compatable with canonicalization function
// for reference :- https://datatracker.ietf.org/doc/html/rfc6376#section-3.4.1
export function parseDkimSignature(dkimHeader: string): [[string, string]] {
  // Find the first colon to separate header name from value
  const colonIndex = dkimHeader.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid header format: no colon found');
  }

  // Extract header name (everything before the colon, trimmed)
  const headerName = dkimHeader.substring(0, colonIndex).trim();

  // Extract header value (everything after the colon, preserving all whitespace)
  const headerValue = dkimHeader
    .substring(colonIndex + 1)
    .replace(/b\s*=\s*([^;]*)/, 'b=');

  return [[headerName, headerValue]];
}

// Select signed header included in block hash
// the selected signed header is selectd according to rfc:-
// RFC 6376 - https://datatracker.ietf.org/doc/html/rfc6376#section-5.4.2
export function selectSignedHeadersNew(
  allHeaders: string[][],
  wantedHeaders: string[]
): string[][] {
  const signHeaders: string[][] = [];
  const lastIndex: Record<string, number> = {};

  // Process each wanted header in order
  for (const headerName of wantedHeaders) {
    const lowerHeaderName = headerName.toLowerCase().trim();

    // Start scanning from the last matched position (or from end if first time) RFC 6376 section-5.4.2
    let i = lastIndex[lowerHeaderName] ?? allHeaders.length;

    while (i > 0) {
      i--;
      if (allHeaders[i] && allHeaders[i][0].toLowerCase() === lowerHeaderName) {
        signHeaders.push(allHeaders[i]);
        break;
      }
    }

    // Update last index for this header name
    lastIndex[lowerHeaderName] = i;
  }

  return signHeaders;
}

/**
 * DKIM Header Canonicalization Functions
 * Based on RFC 6376 (formerly RFC 4871)
 * https://datatracker.ietf.org/doc/html/rfc6376#section-3.4
 * Supports both "simple" and "relaxed" canonicalization algorithms
 * for email headers used in DKIM email signatures.
 */
export function canonicalizeHeaders(headers: any, algorithm: string) {
  if (algorithm === 'simple') {
    return canonicalizeHeadersSimple(headers);
  } else if (algorithm === 'relaxed') {
    return canonicalizeHeadersRelaxed(headers);
  } else {
    throw new Error(`Invalid canonicalization algorithm: ${algorithm}`);
  }
}

function canonicalizeHeadersSimple(headers: [any, any][]) {
  // RFC 6376: Simple canonicalization makes no changes to headers
  return headers.map(([name, value]) => [name, value]);
}

// RFC 6376: relaxed canonicalization
function canonicalizeHeadersRelaxed(headers: [any, any][]) {
  return headers.map(([name, value]) => {
    // 1. Convert header field names to lowercase
    const lowerName = name.toLowerCase().trim();

    // 2. Unfold header field continuation lines (remove CRLF followed by WSP)
    let unfoldedValue = unfoldHeaderValue(value);

    // 3. Compress sequences of WSP to single space
    unfoldedValue = compressWhitespace(unfoldedValue);

    // 4. Remove WSP at start and end of field value
    unfoldedValue = unfoldedValue.trim();

    // 5. Add CRLF at end
    return [lowerName, unfoldedValue + '\r\n'];
  });
}

function compressWhitespace(content: string) {
  return content.replace(/[\t ]+/g, ' ');
}

function unfoldHeaderValue(content: string) {
  // Remove CRLF followed by WSP (folding whitespace)
  return content.replace(/\r?\n[\t ]/g, ' ');
}

// This computes a cryptographic hash of email headers using either "simple" or "relaxed" DKIM canonicalization methods.
export function computeCanonicalizedHeaderHash(
  hash: crypto.Hash,
  headers: Array<Array<any>>,
  sigHdr: Array<Array<any>>,
  canon: string
) {
  for (const hdr of headers) {
    hash.update(Buffer.from(hdr[0]));
    hash.update(Buffer.from(':'));
    hash.update(Buffer.from(hdr[1]));
  }

  // console.log("\nsigHdr[0], sigHdr[1]",sigHdr[0])

  hash.update(Buffer.from(sigHdr[0][0]));
  hash.update(Buffer.from(':'));
  // This is because relaxed canon have \r\n at end of every header value except signature
  if (canon == 'relaxed')
    hash.update(Buffer.from(sigHdr[0][1].replace(/\s+$/gm, '')));
  else hash.update(Buffer.from(sigHdr[0][1]));
}

// Build EMSA-PKCS#1 v1.5 block: ASN.1 prefix + __0xff__ padding + framing (__0x0001…00__).
export function encodeRsaPkcs1Digest(
  digest: Buffer,
  algName: string,
  keySize: number
): bigint {
  const prefix = DIGEST_INFO[algName] || Buffer.alloc(0);
  const t = Buffer.concat([prefix, digest]);
  const psLen = keySize - t.length - 3;
  const padding = Buffer.alloc(psLen, 0xff);
  const em = Buffer.concat([
    Buffer.from([0x00, 0x01]),
    padding,
    Buffer.from([0x00]),
    t,
  ]);
  return BigInt(`0x${em.toString('hex')}`);
}
