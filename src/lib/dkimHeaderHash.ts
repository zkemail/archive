import type { HeaderPair } from './utils';

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
  allHeaders: HeaderPair[],
  wantedHeaders: string[]
): HeaderPair[] {
  const signHeaders: HeaderPair[] = [];
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
export function canonicalizeHeaders(
  headers: HeaderPair[],
  algorithm: string
): HeaderPair[] {
  if (algorithm === 'simple') {
    return canonicalizeHeadersSimple(headers);
  } else if (algorithm === 'relaxed') {
    return canonicalizeHeadersRelaxed(headers);
  } else {
    throw new Error(`Invalid canonicalization algorithm: ${algorithm}`);
  }
}

function canonicalizeHeadersSimple(headers: HeaderPair[]): HeaderPair[] {
  // RFC 6376: Simple canonicalization makes no changes to headers
  return headers.map(([name, value]): HeaderPair => [name, value]);
}

// RFC 6376: relaxed canonicalization
function canonicalizeHeadersRelaxed(headers: HeaderPair[]): HeaderPair[] {
  return headers.map(([name, value]): HeaderPair => {
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

// Shared byte preparation keeps browser and server hashes identical.
export function canonicalizedHeaderData(
  headers: HeaderPair[],
  sigHdr: HeaderPair[],
  canon: string
): string {
  const signed = headers.map(([name, value]) => name + ':' + value).join('');
  const signatureValue =
    canon === 'relaxed' ? sigHdr[0][1].replace(/\s+$/gm, '') : sigHdr[0][1];
  return signed + sigHdr[0][0] + ':' + signatureValue;
}
