import { ParsedEmail } from '@zk-email/sdk';
// import { parseEmail as parseEmailUtils } from '@zk-email/sdk';
import { type ClassValue, clsx } from 'clsx';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { RateLimiterMemory } from 'rate-limiter-flexible';
import { twMerge } from 'tailwind-merge';

import type { KeyType } from '@/generated/prisma/client';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSenderDomain(parsedEmail: ParsedEmail): string {
  const dkimHeader = parsedEmail.headers.get('DKIM-Signature')?.[0] || '';
  return dkimHeader.match(/d=([^;]+)/)?.[1] || '';
}

export function decodeMimeEncodedText(encodedText: string) {
  const matches = encodedText.match(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=(.*)/);
  if (!matches) return encodedText; // Return as is if no match is found

  const charset = matches[1]; // Extract the character set (e.g., UTF-8)
  const encoding = matches[2].toUpperCase(); // Encoding type: Q (Quoted-Printable) or B (Base64)
  const encodedContent = matches[3];

  if (encoding === 'Q') {
    // Decode Quoted-Printable
    const decoded = encodedContent
      .replace(/_/g, ' ') // Replace underscores with spaces
      .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      ); // Decode =XX to characters
    const remainingText = matches[4] ? matches[4].trim() : ''; // Capture any text after the encoded part
    return (
      new TextDecoder(charset).decode(
        new Uint8Array([...decoded].map((c) => c.charCodeAt(0)))
      ) + remainingText
    );
  } else if (encoding === 'B') {
    // Decode Base64
    const decoded = atob(encodedContent); // Decode Base64
    return new TextDecoder(charset).decode(
      new Uint8Array([...decoded].map((c) => c.charCodeAt(0)))
    );
  }

  return encodedText; // Return the original text if unhandled encoding
}

export const formatDate = (timestamp: string) => {
  try {
    let date: Date;

    // Try parsing as milliseconds first
    const msTimestamp = parseInt(timestamp);

    if (!isNaN(msTimestamp) && msTimestamp.toString().length > 4) {
      date = new Date(msTimestamp);
    } else {
      date = new Date(timestamp);
    }

    if (date.toString() === 'Invalid Date') {
      throw new Error('Invalid date format');
    }

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid date';
  }
};

export async function getFileContent(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (!content) {
        return rej('File has no content');
      }
      res(content.toString());
    };
    reader.readAsText(file);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
let relayerUtilsResolver: (value: any) => void;
const relayerUtilsInit: Promise<void> = new Promise((resolve) => {
  relayerUtilsResolver = resolve;
});

const emlPubKeyCache = new Map();

// export async function parseEmail(
//   eml: string,
//   ignoreBodyHashCheck = false
// ): Promise<ParsedEmail> {
//   try {
//     await relayerUtilsInit;

//     const publicKey = emlPubKeyCache.get(eml);

//     let parsedEmail;
//     if (publicKey) {
//       // ignoreBodyHashCheck is not needed here, since parseEmail
//       // will internally not verify the pubkey if it is provided
//       parsedEmail = await parseEmailUtils(eml, publicKey);
//     } else {
//       console.log('parsing email no pub key');
//       parsedEmail = await parseEmailUtils(eml, ignoreBodyHashCheck);
//       console.log('parsed email');
//       emlPubKeyCache.set(eml, parsedEmail.publicKey);

//       try {
//         const { senderDomain, selector } = await extractEMLDetails(
//           eml,
//           parsedEmail
//         );

//         await fetch('https://archive.zk.email/api/dsp', {
//           method: 'POST',
//           body: JSON.stringify({
//             domain: senderDomain,
//             selector: selector,
//           }),
//         });

//         // Do not stop function flow if this fails - warn only
//       } catch (err) {
//         console.warn('Failed to findOrCreateDSP: ', err);
//       }
//     }

//     return parsedEmail as ParsedEmail;
//   } catch (err) {
//     console.error('Failed to parse email: ', err);
//     throw err;
//   }
// }

// export async function extractEMLDetails(
//   emlContent: string,
//   parsedEmail?: ParsedEmail,
//   ignoreBodyHashCheck = false
// ) {
//   const headers: Record<string, string> = {};
//   const lines = emlContent.split('\n');

//   let headerPart = true;
//   const headerLines = [];

//   // Parse headers
//   for (const line of lines) {
//     if (headerPart) {
//       if (line.trim() === '') {
//         headerPart = false; // End of headers
//       } else {
//         headerLines.push(line);
//       }
//     }
//   }

//   // Join multi-line headers and split into key-value pairs
//   const joinedHeaders = headerLines
//     .map((line) =>
//       line.startsWith(' ') || line.startsWith('\t')
//         ? line.trim()
//         : `\n${line.trim()}`
//     )
//     .join('')
//     .split('\n');

//   joinedHeaders.forEach((line) => {
//     const [key, ...value] = line.split(':');
//     if (key) headers[key.trim()] = value.join(':').trim();
//   });

//   if (!parsedEmail) {
//     parsedEmail = await parseEmail(emlContent, ignoreBodyHashCheck);
//   }
//   const emailBodyMaxLength = parsedEmail.cleanedBody.length;
//   const headerLength = parsedEmail.canonicalizedHeader.length;

//   const dkimHeader = parsedEmail.headers.get('DKIM-Signature')?.[0] || '';
//   const selector = dkimHeader.match(/s=([^;]+)/)?.[1] || '';

//   const senderDomain = getSenderDomain(parsedEmail);
//   const emailQuery = `from:${senderDomain}`;

//   return {
//     senderDomain,
//     headerLength,
//     emailQuery,
//     emailBodyMaxLength,
//     selector,
//   };
// }

// ═══════════════════════════════════════════════════════════════════════════
// Types and Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export type DomainAndSelector = {
  domain: string;
  selector: string;
};

export type jwkSet = {
  id: number;
  x509Certificate: string;
  jwks: string;
  lastUpdated: Date;
  provenanceVerified: boolean | null;
};

export interface DnsDkimFetchResult {
  domain: string;
  selector: string;
  value: string;
  timestamp: Date;
  keyType: KeyType;
  keyDataBase64: string | null;
}

export const DspSourceIdentifiers = [
  'top_1m_lookup',
  'api',
  'selector_guesser',
  'seed',
  'try_selectors',
  'api_auto',
  'scraper',
  'public_key_gcd_batch',
  'public_key_gcd_cloud_function',
  'unknown',
] as const;
export type DspSourceIdentifier = (typeof DspSourceIdentifiers)[number];

export const KeySourceIdentifiers = [
  'public_key_gcd_batch',
  'public_key_gcd_cloud_function',
  'unknown',
] as const;
export type KeySourceIdentifier = (typeof KeySourceIdentifiers)[number];

// ═══════════════════════════════════════════════════════════════════════════
// DKIM Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

export function kValueToKeyType(s: string | null | undefined): KeyType {
  if (s === null || s === undefined) {
    // if k is not specified, RSA is implied, see https://datatracker.ietf.org/doc/html/rfc6376#section-3.6.1
    return 'RSA';
  }
  if (s.toLowerCase() === 'rsa') {
    return 'RSA';
  }
  if (s.toLowerCase() === 'ed25519') {
    return 'Ed25519';
  }
  throw new Error(`Unknown key type: "${s}"`);
}

// relaxed implementation of Tag=Value List, see https://datatracker.ietf.org/doc/html/rfc6376#section-3.2
export function parseDkimTagList(dkimValue: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = dkimValue.split(';').map((part) => part.trim());
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i <= 0) {
      continue;
    }
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      // duplicate key, keep the longer value
      if (value.length > result[key].length) {
        result[key] = value;
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Record Functions
// ═══════════════════════════════════════════════════════════════════════════

export function getCanonicalRecordString(
  dsp: DomainAndSelector,
  dkimRecordValue: string
): string {
  return `${dsp.selector}._domainkey.${dsp.domain} TXT "${dkimRecordValue}"`;
}

// Canonicalize X.509 certificates
function canonicalizeX509(certString: string): string {
  const certs = JSON.parse(certString);
  const sortedEntries = Object.entries(certs).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const sortedCerts = Object.fromEntries(sortedEntries);
  return JSON.stringify(sortedCerts, Object.keys(sortedCerts).sort());
}

// Canonicalize JWKS
function canonicalizeJwks(jwksString: string): string {
  const jwks = JSON.parse(jwksString);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedKeys = jwks.keys.sort((a: any, b: any) =>
    a.kid.localeCompare(b.kid)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canonicalKeys = sortedKeys.map((key: any) => {
    const orderedKey: Record<string, unknown> = {};
    Object.keys(key)
      .sort()
      .forEach((k) => (orderedKey[k] = key[k]));
    return orderedKey;
  });
  return JSON.stringify({ keys: canonicalKeys }, null, 0);
}

export function getCanonicalJWKRecordString(jwkSetData: jwkSet): string {
  const canonicalX509 = canonicalizeX509(jwkSetData.x509Certificate);
  const canonicalJwks = canonicalizeJwks(jwkSetData.jwks);

  const canonicalObject = {
    x509Certificate: canonicalX509,
    jwks: canonicalJwks,
    lastUpdated: jwkSetData.lastUpdated,
    provenanceVerified: jwkSetData.provenanceVerified,
  };

  return JSON.stringify(canonicalObject, Object.keys(canonicalObject).sort());
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

// ═══════════════════════════════════════════════════════════════════════════
// Google OAuth Certificate Functions
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchJsonWebKeySet(): Promise<string> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) {
      throw new Error('Cannot fetch Google JSON Web Key Set');
    }
    const jsonData = await response.json();
    const jsonWebKeySet = JSON.stringify(jsonData, null, 2);
    return jsonWebKeySet;
  } catch (error) {
    console.error('Error fetching JSON Web Key Set:', error);
    return '';
  }
}

export async function fetchx509Cert(): Promise<string> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/certs');
    if (!response.ok) {
      throw new Error('Cannot fetch Google X.509 certificate');
    }
    const jsonData = await response.json();
    const x509Cert = JSON.stringify(jsonData, Object.keys(jsonData).sort(), 2);
    return x509Cert;
  } catch (error) {
    console.error('Error fetching X.509 certificate:', error);
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Source Identifier Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function stringToDspSourceIdentifier(s: string): DspSourceIdentifier {
  const sourceIdentifier = DspSourceIdentifiers.find((id) => id === s);
  if (sourceIdentifier) {
    return sourceIdentifier;
  }
  return 'unknown';
}

export function stringToKeySourceIdentifier(s: string): KeySourceIdentifier {
  const sourceIdentifier = KeySourceIdentifiers.find((id) => id === s);
  if (sourceIdentifier) {
    return sourceIdentifier;
  }
  return 'unknown';
}

export function dspSourceIdentifierToHumanReadable(
  sourceIdentifierStr: string
) {
  switch (stringToDspSourceIdentifier(sourceIdentifierStr)) {
    case 'top_1m_lookup':
    case 'scraper':
      return 'Scraped';
    case 'api':
      return 'Inbox upload';
    case 'api_auto':
      return 'Inbox upload';
    case 'selector_guesser':
      return 'Selector guesser';
    case 'seed':
      return 'Seed';
    case 'try_selectors':
      return 'Try selectors';
    case 'public_key_gcd_batch':
      return 'Mail archive';
    case 'public_key_gcd_cloud_function':
      return 'Inbox upload';
    case 'unknown':
      return 'Unknown';
  }
}

export function keySourceIdentifierToHumanReadable(
  sourceIdentifierStr: string
) {
  switch (stringToKeySourceIdentifier(sourceIdentifierStr)) {
    case 'public_key_gcd_batch':
      return 'Reverse engineered';
    case 'public_key_gcd_cloud_function':
      return 'Reverse engineered';
    case 'unknown':
      return 'Unknown';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Date Validation Helper
// ═══════════════════════════════════════════════════════════════════════════

export function isValidDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DKIM Header Parsing Functions
// ═══════════════════════════════════════════════════════════════════════════

// Regex to extract DKIM-Signature header blocks
export const DKIM_HEADER_REGEX = /^DKIM-Signature:\s*(.+?)(?=\r?\n[^ \t])/gims;

export const DIGEST_INFO: Record<string, Buffer> = {
  'rsa-sha1': Buffer.from('3021300906052b0e03021a05000414', 'hex'),
  'rsa-sha256': Buffer.from('3031300d060960864801650304020105000420', 'hex'),
  'rsa-sha512': Buffer.from('3051300d060960864801650304020305000440', 'hex'),
};

// Extract all DKIM-Signature blocks and return [rawHeader]
export function getDkimSigsArray(rawEmail: string): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = DKIM_HEADER_REGEX.exec(rawEmail))) {
    const rawHeader = match[0];
    blocks.push(rawHeader);
  }
  return blocks;
}

export function parseDkimTagListV2(rawHeader: string): Record<string, string> {
  const unfoldedSignature = rawHeader
    .replace(/\r?\n\s+/g, ' ')
    .replace(/^DKIM-Signature\s*:\s*/i, '');
  return Object.fromEntries(
    unfoldedSignature
      .trim()
      .split(';')
      .map((part) => {
        const [k, v] = part.split('=', 2).map((x) => x.trim());
        return [k, v];
      })
  );
}

// Note:- This follows RFC 5322 for parsing the Email header
export function parseEmailHeaderV2(rawEmail: { toString: () => string }) {
  const emailContent =
    typeof rawEmail === 'string' ? rawEmail : rawEmail.toString();

  // Split email into headers and body at first blank line
  const headerBodySplit = emailContent.split(/\r?\n\r?\n/);
  const headerSection = headerBodySplit[0];

  // Split headers by lines, but handle folded headers (RFC 5322)
  const headerLines = [];
  const lines = headerSection.split(/(?<=\r?\n)/);

  let currentHeader = '';

  for (const line of lines) {
    if (line.match(/^[\t ]/)) {
      currentHeader += line;
    } else {
      if (currentHeader) {
        headerLines.push(currentHeader);
      }
      currentHeader = line;
    }
  }

  if (currentHeader) {
    headerLines.push(currentHeader);
  }

  const headers = [];

  for (const headerLine of headerLines) {
    const colonIndex = headerLine.indexOf(':');
    if (colonIndex === -1) continue;

    const name = headerLine.substring(0, colonIndex);
    const value = headerLine.substring(colonIndex + 1);

    headers.push([name, value]);
  }
  return headers;
}

// Function to parse DKIM header into [[header_name, header_value]] format
export function parseDkimSignature(dkimHeader: string): [[string, string]] {
  const colonIndex = dkimHeader.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid header format: no colon found');
  }

  const headerName = dkimHeader.substring(0, colonIndex).trim();
  const headerValue = dkimHeader
    .substring(colonIndex + 1)
    .replace(/b\s*=\s*([^;]*)/, 'b=');

  return [[headerName, headerValue]];
}

// Select signed headers according to RFC 6376 section 5.4.2
export function selectSignedHeadersnew(
  allHeaders: string[][],
  wantedHeaders: string[]
): string[][] {
  const signHeaders: string[][] = [];
  const lastIndex: Record<string, number> = {};

  for (const headerName of wantedHeaders) {
    const lowerHeaderName = headerName.toLowerCase().trim();

    let i = lastIndex[lowerHeaderName] ?? allHeaders.length;

    while (i > 0) {
      i--;
      if (allHeaders[i] && allHeaders[i][0].toLowerCase() === lowerHeaderName) {
        signHeaders.push(allHeaders[i]);
        break;
      }
    }

    lastIndex[lowerHeaderName] = i;
  }

  return signHeaders;
}

// ═══════════════════════════════════════════════════════════════════════════
// DKIM Header Canonicalization Functions (RFC 6376)
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function canonicalizeHeaders(headers: any, algorithm: string) {
  if (algorithm === 'simple') {
    return canonicalizeHeadersSimple(headers);
  } else if (algorithm === 'relaxed') {
    return canonicalizeHeadersRelaxed(headers);
  } else {
    throw new Error(`Invalid canonicalization algorithm: ${algorithm}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canonicalizeHeadersSimple(headers: [any, any][]) {
  return headers.map(([name, value]) => [name, value]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canonicalizeHeadersRelaxed(headers: [any, any][]) {
  return headers.map(([name, value]) => {
    const lowerName = name.toLowerCase().trim();

    let unfoldedValue = unfoldHeaderValue(value);
    unfoldedValue = compressWhitespace(unfoldedValue);
    unfoldedValue = unfoldedValue.trim();

    return [lowerName, unfoldedValue + '\r\n'];
  });
}

function compressWhitespace(content: string) {
  return content.replace(/[\t ]+/g, ' ');
}

function unfoldHeaderValue(content: string) {
  return content.replace(/\r?\n[\t ]/g, ' ');
}

// Computes a cryptographic hash of email headers using DKIM canonicalization
export function computeCanonicalizedHeaderHash(
  hash: { update: (data: Buffer) => void },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers: Array<Array<any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sigHdr: Array<Array<any>>,
  canon: string
) {
  for (const hdr of headers) {
    hash.update(Buffer.from(hdr[0]));
    hash.update(Buffer.from(':'));
    hash.update(Buffer.from(hdr[1]));
  }

  hash.update(Buffer.from(sigHdr[0][0]));
  hash.update(Buffer.from(':'));
  if (canon == 'relaxed')
    hash.update(Buffer.from(sigHdr[0][1].replace(/\s+$/gm, '')));
  else hash.update(Buffer.from(sigHdr[0][1]));
}

// Build EMSA-PKCS#1 v1.5 block
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
