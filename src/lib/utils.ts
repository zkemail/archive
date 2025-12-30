import { ParsedEmail } from '@zk-email/sdk';
// import { parseEmail as parseEmailUtils } from '@zk-email/sdk';
import { type ClassValue, clsx } from 'clsx';
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
