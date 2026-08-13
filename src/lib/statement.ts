/**
 * Signed observation statements (REG-736).
 *
 * A statement is a compact JWS (RFC 7515) whose payload attests one archive
 * observation: a (domain, selector, key value) seen through one channel, with
 * the window we observed it in and the time we issued the attestation. It lets
 * a consumer embed archive evidence in their own artifact and re-verify it
 * offline years later, with no live dependency on this service.
 *
 * What it is and is not: the signature authenticates *who* said it and *what*
 * they said. It carries no external anchor, so it does not prove *when* we said
 * it: `iat` is our own unattested clock. Verifying a statement means trusting
 * this archive's key and timestamps. Consumers who need an unforgeable "when"
 * are expected to timestamp the statement bytes themselves.
 *
 * Provenance is per channel, never the union window. See the DkimRecord
 * per-channel columns: a live-DNS sighting and a GCD recovery mean different
 * things and are attested separately, so a record seen both ways yields two
 * statements rather than one blended claim.
 *
 * The payload shape is fixed by the format agreed on the issue; the reference
 * verifier is kychee-com/kysigned `src/bundle/archiveStatement.ts`. Changing
 * any field name, the issuer, or the version breaks every deployed verifier, so
 * additive changes require a new `v`.
 */
import { CompactSign, importJWK, type JWK } from 'jose';

import PUBLISHED_JWKS from './archive-statement-jwks.json';
import { logger } from './logger';

// ─── Format constants ────────────────────────────────────────────────────────

/** Format version. Bump only for a breaking payload change. */
export const STATEMENT_VERSION = 1;

/**
 * Issuer. Verifiers pin this exact string, so it defaults to a hard constant:
 * a deployment that signs under a different issuer mints statements no consumer
 * accepts. The override exists only so a staging deployment can be made
 * deliberately non-verifiable against the production JWKS, and should never be
 * set in production.
 */
export const STATEMENT_ISSUER =
  process.env.ARCHIVE_STATEMENT_ISSUER || 'archive.zk.email';

/** Signature algorithms we are willing to sign with. */
const SUPPORTED_ALGS = ['EdDSA', 'ES256'] as const;
type SupportedAlg = (typeof SUPPORTED_ALGS)[number];

/**
 * Channels we are currently willing to put a signature on.
 *
 * A signature is a claim we stand behind, so a channel only belongs here once
 * we can vouch for how its observations got into the database. `live_dns`
 * qualifies: those rows are written by our own resolver reading a TXT record,
 * and no external input reaches them.
 *
 * `gcd_recovered` does not. Its window derives from email we were given rather
 * than from anything we observed ourselves, and the ingest path that accepts
 * that email does not establish that the email is genuine (REG-739). Those
 * observations are still exposed unsigned through /api/key's `observations`
 * array, where a consumer can weigh them for themselves, but we do not attest
 * to them.
 *
 * Whether that can be fixed is open: GCD proves a key signed two messages, not
 * that the domain published it, so this may be a permanent distinction rather
 * than a gap to close. Nothing outside this set assumes either answer. If
 * `gcd_recovered` ever does qualify, adding it back here is the only change
 * needed: the payload, the endpoint and the format already handle it, and the
 * format's `source` field exists precisely so the two can be told apart.
 */
const SIGNABLE_SOURCES: ReadonlySet<ObservationSource> =
  new Set<ObservationSource>(['live_dns']);

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * How an observation reached the archive.
 *
 * `live_dns`:      we resolved `<selector>._domainkey.<domain>` and read this
 *                   TXT record back. A direct sighting of what the domain
 *                   published.
 * `gcd_recovered`: we recovered the public key by taking the GCD over two
 *                   DKIM signatures from that domain. It proves the key signed
 *                   those messages; it says nothing about DNS publication.
 */
export type ObservationSource = 'live_dns' | 'gcd_recovered';

/** One channel's window over a single key value. */
export type ArchiveObservation = {
  source: ObservationSource;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/** The attested record, in the wire shape (snake_case, as specified). */
export type StatementRecord = {
  id?: string;
  domain: string;
  selector: string;
  value: string;
  source: ObservationSource;
  first_seen_at: string;
  last_seen_at: string;
};

/** The full JWS payload. */
export type StatementPayload = {
  v: number;
  iss: string;
  iat: number;
  record: StatementRecord;
};

/** The subset of a DkimRecord a statement is built from. */
export type StatementSourceRecord = {
  id: number;
  value: string;
  dnsFirstSeenAt: Date | null;
  dnsLastSeenAt: Date | null;
  gcdFirstSeenAt: Date | null;
  gcdLastSeenAt: Date | null;
};

// ─── Observation extraction ──────────────────────────────────────────────────

/**
 * The observations a record can stand behind, one per channel that has a
 * complete window.
 *
 * A channel needs BOTH bounds to be claimable. A half-known window is treated
 * as unknown rather than patched up: these statements are meant to be embedded
 * in third-party evidence, so a guessed bound is worse than a missing one.
 * Legacy records whose channels the backfill could not disentangle have no
 * bounds at all and yield nothing until DNS observes them again.
 */
export function observationsForRecord(
  record: StatementSourceRecord
): ArchiveObservation[] {
  const observations: ArchiveObservation[] = [];

  if (record.dnsFirstSeenAt && record.dnsLastSeenAt) {
    observations.push({
      source: 'live_dns',
      firstSeenAt: record.dnsFirstSeenAt,
      lastSeenAt: record.dnsLastSeenAt,
    });
  }

  if (record.gcdFirstSeenAt && record.gcdLastSeenAt) {
    observations.push({
      source: 'gcd_recovered',
      firstSeenAt: record.gcdFirstSeenAt,
      lastSeenAt: record.gcdLastSeenAt,
    });
  }

  return observations;
}

/**
 * The subset of a record's observations we are currently willing to sign.
 *
 * Exported so the signing path and the format self-check apply the same rule
 * rather than each deciding for itself: the check mints its own key when none
 * is configured, and without this it would happily attest a channel the real
 * endpoint withholds.
 */
export function signableObservationsForRecord(
  record: StatementSourceRecord
): ArchiveObservation[] {
  return observationsForRecord(record).filter((observation) =>
    SIGNABLE_SOURCES.has(observation.source)
  );
}

/**
 * RFC 3339 UTC with a `Z` zone. `toISOString()` already emits exactly this
 * (always UTC, always `Z`, milliseconds included), which the reference verifier
 * accepts.
 */
export function toRfc3339Utc(date: Date): string {
  return date.toISOString();
}

// ─── Payload construction ────────────────────────────────────────────────────

/**
 * Build the payload for one (record, observation) pair.
 *
 * `id` is the archive's own record id as a string. It is stable but not unique
 * across statements on its own: a record observed through both channels yields
 * two statements sharing an id, distinguished by `source`.
 *
 * `issuedAt` is injected so a batch of statements from one request shares an
 * issuance instant and the whole thing stays deterministic under test.
 */
export function buildStatementPayload(
  domain: string,
  selector: string,
  record: StatementSourceRecord,
  observation: ArchiveObservation,
  issuedAt: Date
): StatementPayload {
  return {
    v: STATEMENT_VERSION,
    iss: STATEMENT_ISSUER,
    // RFC 7519 NumericDate: whole seconds. The verifier rejects a non-integer.
    iat: Math.floor(issuedAt.getTime() / 1000),
    record: {
      id: String(record.id),
      domain: domain.toLowerCase(),
      selector: selector.toLowerCase(),
      value: record.value,
      source: observation.source,
      first_seen_at: toRfc3339Utc(observation.firstSeenAt),
      last_seen_at: toRfc3339Utc(observation.lastSeenAt),
    },
  };
}

// ─── Signing key ─────────────────────────────────────────────────────────────

export class StatementSigningUnavailableError extends Error {}

type SigningKey = {
  key: CryptoKey | Uint8Array;
  alg: SupportedAlg;
  kid: string;
};

let cachedSigningKey: Promise<SigningKey> | null = null;

/** JWK members that only ever appear on a private key. */
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const;

function isPrivateJwk(jwk: JWK): boolean {
  return PRIVATE_JWK_MEMBERS.some((member) => member in jwk);
}

/**
 * The published verification keys, as committed to this repo.
 *
 * Returns a copy, and drops anything carrying private members. The generator
 * prints the private and public halves back to back, so pasting the wrong block
 * into the committed file is a plausible slip, and this endpoint publishes that
 * file verbatim to the world. Since the key set is append-only, a leaked kid
 * could never be un-published, so the guard is here rather than only in the
 * check script. Copying also stops any caller from mutating what the public
 * endpoint serves.
 */
export function getPublishedJwks(): { keys: JWK[] } {
  const published = PUBLISHED_JWKS as { keys: JWK[] };
  const keys: JWK[] = [];

  for (const jwk of published.keys) {
    if (isPrivateJwk(jwk)) {
      logger.error('statement_jwks_private_key_suppressed', { kid: jwk.kid });
      continue;
    }
    keys.push({ ...jwk });
  }

  return { keys };
}

function parseSigningJwk(raw: string): JWK & { kid?: string; alg?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StatementSigningUnavailableError(
      'ARCHIVE_STATEMENT_SIGNING_JWK is not valid JSON'
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new StatementSigningUnavailableError(
      'ARCHIVE_STATEMENT_SIGNING_JWK must be a JWK object'
    );
  }
  return parsed as JWK & { kid?: string; alg?: string };
}

/**
 * The JWK members that define the public half for the curve types we sign
 * with. `x`/`y` carry the point for EC (ES256); `x` alone for OKP (Ed25519).
 * Returns the first field that differs, or null when the two agree.
 */
function publicMaterialMismatch(
  signing: JWK & { alg?: string },
  published: JWK & { alg?: string }
): string | null {
  for (const field of ['kty', 'crv', 'x', 'y', 'alg'] as const) {
    if (signing[field] !== published[field]) {
      return `${field} differs`;
    }
  }
  return null;
}

async function loadSigningKey(): Promise<SigningKey> {
  const raw = process.env.ARCHIVE_STATEMENT_SIGNING_JWK;
  if (!raw) {
    throw new StatementSigningUnavailableError(
      'ARCHIVE_STATEMENT_SIGNING_JWK is not configured'
    );
  }

  const jwk = parseSigningJwk(raw);

  if (!jwk.kid) {
    throw new StatementSigningUnavailableError('signing JWK has no kid');
  }
  if (!jwk.d) {
    throw new StatementSigningUnavailableError(
      'signing JWK has no private component'
    );
  }

  const alg = jwk.alg as SupportedAlg | undefined;
  if (!alg || !SUPPORTED_ALGS.includes(alg)) {
    throw new StatementSigningUnavailableError(
      `signing JWK alg must be one of ${SUPPORTED_ALGS.join(', ')}`
    );
  }

  // Refuse to sign under a kid no consumer can resolve. Without this a key
  // rotation that updates the secret but forgets the committed JWKS would mint
  // statements that every verifier rejects as `unknown-key`, and because
  // consumers archive statements for years, the damage outlives the mistake.
  const published = getPublishedJwks().keys.find((k) => k.kid === jwk.kid);
  if (!published) {
    throw new StatementSigningUnavailableError(
      `signing kid "${jwk.kid}" is absent from the published JWKS`
    );
  }

  // Matching on kid alone is not enough: kids are date-stamped by default, so
  // regenerating a key on the same day reuses one. The check would pass while
  // every statement verified against the published half as `bad-signature`,
  // and consumers would only discover it years later. Compare the actual
  // public material the verifier will use.
  const mismatch = publicMaterialMismatch(jwk, published);
  if (mismatch) {
    throw new StatementSigningUnavailableError(
      `signing key does not match the published JWKS entry for kid "${jwk.kid}" (${mismatch})`
    );
  }

  const key = await importJWK(jwk, alg);
  return { key, alg, kid: jwk.kid };
}

/**
 * The configured signing key, imported once per process.
 *
 * A failed load is not cached, so fixing the environment does not require a
 * redeploy of an otherwise healthy instance.
 */
export async function getSigningKey(): Promise<SigningKey> {
  if (!cachedSigningKey) {
    cachedSigningKey = loadSigningKey().catch((error) => {
      cachedSigningKey = null;
      throw error;
    });
  }
  return cachedSigningKey;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Sign one payload into a compact JWS.
 *
 * JWS signs the exact serialized bytes, so no canonicalization scheme is
 * involved: whatever `JSON.stringify` produces here is what the verifier
 * re-reads out of the payload segment.
 */
export async function signStatement(
  payload: StatementPayload
): Promise<string> {
  const { key, alg, kid } = await getSigningKey();

  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg, kid })
    .sign(key);
}

/**
 * Every statement issuable for a record: one per channel with a complete
 * window. A record with no attributable observation yields none.
 */
export async function signStatementsForRecord(
  domain: string,
  selector: string,
  record: StatementSourceRecord,
  issuedAt: Date
): Promise<string[]> {
  const observations = signableObservationsForRecord(record);

  return Promise.all(
    observations.map((observation) =>
      signStatement(
        buildStatementPayload(domain, selector, record, observation, issuedAt)
      )
    )
  );
}
