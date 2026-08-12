#!/usr/bin/env tsx
/**
 * Self-check for signed observation statements (REG-736).
 *
 * Mints statements, then puts them through the same checks the reference
 * consumer applies (kychee-com/kysigned `src/bundle/archiveStatement.ts`):
 * algorithm allowlist, kid resolution against the published JWKS, signature
 * verification, and the payload schema. If this passes, a statement this
 * deployment issues is one that verifier accepts.
 *
 * Usage:
 *   pnpm statement:check                                  # synthetic record
 *   pnpm statement:check --domain <d> --selector <s>      # real archive record
 *
 * With no ARCHIVE_STATEMENT_SIGNING_JWK configured it signs with an ephemeral
 * key so the format itself is still exercised. It also checks the negative cases:
 * tampering and an unknown kid must be rejected, not merely "not accepted".
 */

import 'dotenv/config';

import {
  CompactSign,
  compactVerify,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from 'jose';

import {
  buildStatementPayload,
  getPublishedJwks,
  observationsForRecord,
  signStatement,
  type StatementPayload,
  type StatementSourceRecord,
} from '../src/lib/statement';

// ─── The reference verifier's acceptance rules, restated ─────────────────────
// Mirrors kysigned's parseStatement(). Kept as an independent restatement
// rather than an import so a drift in our own helpers cannot silently redefine
// what "valid" means. This is the contract, not our implementation of it.

const ALLOWED_ALGS = new Set(['EdDSA', 'ES256']);
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isRfc3339Utc(v: unknown): boolean {
  return (
    typeof v === 'string' && RFC3339_UTC.test(v) && !Number.isNaN(Date.parse(v))
  );
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0;
}

function checkPayloadShape(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object')
    return 'payload is not an object';
  const s = payload as Record<string, unknown>;
  if (s.v !== 1) return `v must be 1, got ${JSON.stringify(s.v)}`;
  if (s.iss !== 'archive.zk.email')
    return `iss must be "archive.zk.email", got ${JSON.stringify(s.iss)}`;
  if (typeof s.iat !== 'number' || !Number.isInteger(s.iat))
    return `iat must be an integer, got ${JSON.stringify(s.iat)}`;
  if (!s.record || typeof s.record !== 'object') return 'record is missing';

  const r = s.record as Record<string, unknown>;
  if (!isNonEmptyString(r.domain))
    return 'record.domain must be a non-empty string';
  if (!isNonEmptyString(r.selector))
    return 'record.selector must be a non-empty string';
  if (!isNonEmptyString(r.value))
    return 'record.value must be a non-empty string';
  if (r.source !== 'live_dns' && r.source !== 'gcd_recovered')
    return `record.source must be live_dns or gcd_recovered, got ${JSON.stringify(r.source)}`;
  if (!isRfc3339Utc(r.first_seen_at))
    return `record.first_seen_at must be RFC 3339 UTC, got ${JSON.stringify(r.first_seen_at)}`;
  if (!isRfc3339Utc(r.last_seen_at))
    return `record.last_seen_at must be RFC 3339 UTC, got ${JSON.stringify(r.last_seen_at)}`;
  if (r.id !== undefined && !isNonEmptyString(r.id))
    return 'record.id, when present, must be a non-empty string';
  return null;
}

type VerifyResult =
  | { ok: true; payload: Record<string, unknown>; kid: string }
  | { ok: false; reason: string };

async function verifyStatement(
  jws: string,
  jwks: { keys: JWK[] }
): Promise<VerifyResult> {
  if (typeof jws !== 'string' || jws.split('.').length !== 3) {
    return { ok: false, reason: 'malformed-jws' };
  }

  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    return { ok: false, reason: 'malformed-jws' };
  }

  if (!header.alg || !ALLOWED_ALGS.has(header.alg)) {
    return { ok: false, reason: 'unsupported-alg' };
  }

  const jwk = header.kid
    ? jwks.keys.find((k) => k.kid === header.kid)
    : undefined;
  if (!jwk) return { ok: false, reason: 'unknown-key' };

  let payload: unknown;
  try {
    const key = await importJWK(jwk, header.alg);
    const res = await compactVerify(jws, key, { algorithms: [header.alg] });
    payload = JSON.parse(new TextDecoder().decode(res.payload));
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }

  const shapeError = checkPayloadShape(payload);
  if (shapeError)
    return { ok: false, reason: `malformed-shape: ${shapeError}` };

  return {
    ok: true,
    payload: payload as Record<string, unknown>,
    kid: header.kid!,
  };
}

// ─── Harness ─────────────────────────────────────────────────────────────────

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`
  );
  if (!ok) failures++;
}

function parseArgs(): { domain?: string; selector?: string } {
  const args = process.argv.slice(2);
  const out: { domain?: string; selector?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--domain' && args[i + 1]) out.domain = args[++i];
    else if (args[i] === '--selector' && args[i + 1]) out.selector = args[++i];
  }
  return out;
}

/** A record exercising both channels, so both statement sources are covered. */
const SYNTHETIC_RECORD: StatementSourceRecord = {
  id: 1,
  value:
    'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0example...IDAQAB',
  dnsFirstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
  dnsLastSeenAt: new Date('2026-07-15T08:00:00.000Z'),
  gcdFirstSeenAt: new Date('2025-01-04T11:22:33.000Z'),
  gcdLastSeenAt: new Date('2025-09-30T17:00:00.000Z'),
};

async function main() {
  const { domain: argDomain, selector: argSelector } = parseArgs();

  // ── The published key set ──────────────────────────────────────────────────
  const jwks = getPublishedJwks();
  check(
    'published JWKS has a keys array',
    Array.isArray(jwks.keys),
    `${jwks.keys?.length ?? 0} key(s)`
  );
  check(
    'published JWKS leaks no private key material',
    jwks.keys.every((k) => !('d' in k)),
    'no `d` member on any published key'
  );
  check(
    'every published key carries a kid',
    jwks.keys.every((k) => isNonEmptyString(k.kid))
  );

  // ── Signing key: the configured one, or an ephemeral stand-in ──────────────
  //
  // With a real key configured we exercise the whole production path,
  // `loadSigningKey` guards included. Without one there is nothing to load, so
  // we mint a throwaway key and sign the same payloads directly. That still
  // covers everything the format depends on (payload construction, channel
  // extraction, the envelope, and every verification rule) and only skips the
  // key-loading guards, which have nothing to check when no key is set.
  //
  // The ephemeral key is deliberately NOT injected into the published set:
  // getPublishedJwks() returns a copy so that nothing can mutate what the
  // public endpoint serves, and a check that reached around that would be
  // testing a different program than the one that ships.
  const configured = Boolean(process.env.ARCHIVE_STATEMENT_SIGNING_JWK);
  let effectiveJwks = jwks;
  let sign: (payload: StatementPayload) => Promise<string>;

  if (configured) {
    sign = signStatement;
  } else {
    console.log(
      '\nNote: ARCHIVE_STATEMENT_SIGNING_JWK is not set. Signing with an\n' +
        'ephemeral key so the format is still exercised end to end. This does\n' +
        'not validate the real key or the key-loading guards.\n'
    );
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
      extractable: true,
    });
    const kid = 'ephemeral-check-key';
    effectiveJwks = {
      keys: [
        ...jwks.keys,
        { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA', use: 'sig' },
      ],
    };
    sign = async (payload) =>
      new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'EdDSA', kid })
        .sign(privateKey);
  }

  /** Every statement a record can produce, signed however this run signs. */
  const signRecord = async (
    d: string,
    s: string,
    record: StatementSourceRecord,
    issuedAt: Date
  ): Promise<string[]> =>
    Promise.all(
      observationsForRecord(record).map((observation) =>
        sign(buildStatementPayload(d, s, record, observation, issuedAt))
      )
    );

  // ── Round-trip: sign, then verify exactly as the consumer would ────────────
  const domain = argDomain ?? 'example.com';
  const selector = argSelector ?? 'mail2026';

  let records: StatementSourceRecord[] = [SYNTHETIC_RECORD];
  if (argDomain && argSelector) {
    const { findRecordsWithCache } = await import('../src/lib/db');
    const found = await findRecordsWithCache(argDomain, argSelector);
    check(
      `archive has records for ${argDomain} / ${argSelector}`,
      found.length > 0,
      `${found.length} record(s)`
    );
    if (found.length > 0) records = found;
  }

  const issuedAt = new Date();
  const statements = (
    await Promise.all(
      records.map((r) => signRecord(domain, selector, r, issuedAt))
    )
  ).flat();

  const expected = records.reduce(
    (n, r) => n + observationsForRecord(r).length,
    0
  );
  check(
    'one statement per attributable observation',
    statements.length === expected,
    `${statements.length} statement(s) from ${records.length} record(s)`
  );

  for (const [i, jws] of statements.entries()) {
    const result = await verifyStatement(jws, effectiveJwks);
    check(
      `statement ${i + 1} verifies and matches the agreed schema`,
      result.ok,
      result.ok
        ? `source=${(result.payload.record as Record<string, unknown>).source} kid=${result.kid}`
        : result.reason
    );
  }

  // ── Provenance: channels must not blend ────────────────────────────────────
  const bothChannels = await signRecord(
    domain,
    selector,
    SYNTHETIC_RECORD,
    issuedAt
  );
  const decoded = await Promise.all(
    bothChannels.map(async (jws) => {
      const res = await verifyStatement(jws, effectiveJwks);
      return res.ok ? (res.payload.record as Record<string, unknown>) : null;
    })
  );
  const dns = decoded.find((r) => r?.source === 'live_dns');
  const gcd = decoded.find((r) => r?.source === 'gcd_recovered');
  check(
    'a record seen on both channels yields one statement per channel',
    Boolean(dns && gcd)
  );
  check(
    'the live_dns window is the DNS window, unmixed with GCD',
    dns?.first_seen_at === SYNTHETIC_RECORD.dnsFirstSeenAt!.toISOString() &&
      dns?.last_seen_at === SYNTHETIC_RECORD.dnsLastSeenAt!.toISOString(),
    `${dns?.first_seen_at} → ${dns?.last_seen_at}`
  );
  check(
    'the gcd_recovered window is the GCD window, unmixed with DNS',
    gcd?.first_seen_at === SYNTHETIC_RECORD.gcdFirstSeenAt!.toISOString() &&
      gcd?.last_seen_at === SYNTHETIC_RECORD.gcdLastSeenAt!.toISOString(),
    `${gcd?.first_seen_at} → ${gcd?.last_seen_at}`
  );

  // ── A half-known channel must be silent, not guessed ───────────────────────
  const halfKnown = await signRecord(
    domain,
    selector,
    { ...SYNTHETIC_RECORD, dnsLastSeenAt: null },
    issuedAt
  );
  check(
    'a channel with only one bound yields no statement',
    halfKnown.length === 1,
    `${halfKnown.length} statement(s), gcd only`
  );

  // ── Negative cases: rejection must be active, not incidental ───────────────
  const good = bothChannels[0];
  const [h, p, s] = good.split('.');
  const tampered = `${h}.${Buffer.from(
    Buffer.from(p, 'base64url').toString('utf8').replace('example', 'evil')
  ).toString('base64url')}.${s}`;
  const tamperedResult = await verifyStatement(tampered, effectiveJwks);
  check(
    'a tampered payload is rejected',
    !tamperedResult.ok,
    tamperedResult.ok
      ? 'ACCEPTED: signature is not binding'
      : tamperedResult.reason
  );

  const strangerKid = await verifyStatement(good, { keys: [] });
  check(
    'a statement is rejected when its kid is not published',
    !strangerKid.ok && strangerKid.reason === 'unknown-key',
    strangerKid.ok ? 'ACCEPTED' : strangerKid.reason
  );

  const algNone = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url'
  )}.${p}.`;
  const algNoneResult = await verifyStatement(algNone, effectiveJwks);
  check(
    'alg:none is rejected',
    !algNoneResult.ok && algNoneResult.reason === 'unsupported-alg',
    algNoneResult.ok ? 'ACCEPTED' : algNoneResult.reason
  );

  // ── Statements are immutable snapshots (Ask 5) ─────────────────────────────
  const later = await sign(
    buildStatementPayload(
      domain,
      selector,
      SYNTHETIC_RECORD,
      observationsForRecord(SYNTHETIC_RECORD)[0],
      new Date(issuedAt.getTime() + 60_000)
    )
  );
  const earlierResult = await verifyStatement(good, effectiveJwks);
  const laterResult = await verifyStatement(later, effectiveJwks);
  check(
    'an earlier statement stays valid after a later one is issued',
    earlierResult.ok && laterResult.ok && later !== good
  );

  console.log(
    `\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
