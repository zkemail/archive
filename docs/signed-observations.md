# Signed observation statements

Offline-verifiable, per-record evidence from the DKIM archive.
Tracking issue: [github.com/zkemail/archive/issues/46](https://github.com/zkemail/archive/issues/46).

A **statement** is a compact JWS whose payload attests one archive observation:
a `(domain, selector, key value)` seen through one channel, with the window we
observed it in. You can embed it in your own artifact and re-verify it years
later without this service being reachable.

## What a statement does and does not prove

The signature authenticates **who** said it and **what** they said. It carries
no external anchor, so it does not prove **when** we said it: `iat` is our own
unattested clock, and verifying a statement means trusting this archive's key
and its timestamps.

This is an attestation, not a trustless proof. The witness inclusion proofs and
on-chain checkpoints the archive used to emit are gone; that path was dropped in
the rebuild and nothing produces them any more. If you need an unforgeable
"when", timestamp the statement bytes yourself. The format is designed to sit
inside someone else's anchoring scheme rather than to replace one.

## Provenance: two channels, never blended

A key value can reach the archive two ways, and they mean different things:

| `source`        | What it means                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `live_dns`      | We resolved `<selector>._domainkey.<domain>` and read this TXT record back. A direct sighting of what the domain published.                                              |
| `gcd_recovered` | We recovered the public key by taking the GCD over two DKIM signatures from that domain. It proves the key signed those messages. It says nothing about DNS publication. |

The two are stored in separate columns (`dnsFirstSeenAt` / `dnsLastSeenAt` and
`gcdFirstSeenAt` / `gcdLastSeenAt`) and are attested separately. **A GCD
recovery can never move a live-DNS window, and vice versa.** If you bound key
validity on live DNS, filter on `source === 'live_dns'`.

> **Only `live_dns` observations are currently signed.**
>
> A signature is a claim we stand behind, and a channel only earns one once we
> can vouch for how its observations reached the database. `live_dns` rows are
> written by our own resolver reading a TXT record, with no external input in
> the path. A `gcd_recovered` window instead derives from email we were given,
> and the ingest path that accepts that email does not yet establish it is
> genuine. We are fixing that; until it lands, we are not putting our signature
> on it.
>
> `gcd_recovered` observations are still returned, unsigned, in `/api/key`'s
> `observations` array, so you can weigh them yourself. Nothing about the
> format changes when signing is enabled: a key seen both ways will then yield
> _two_ statements, same record `id`, different `source`, each with its own
> window, which is what the `source` field exists to distinguish. If you only
> consume `live_dns`, this restriction is invisible to you.

For `gcd_recovered`, the times are **the source emails' dates**, not our
processing time: the window is the span between the two messages whose
signatures produced the key.

A channel is claimable only when **both** of its bounds are known. A half-known
window is treated as unknown and yields no statement. A window reconstructed
by the backfill is never wider than the truth, only narrower. See "Legacy
records" below.

## Format

Compact JWS (RFC 7515), `alg: EdDSA` (Ed25519) or `ES256`, `kid` in the
protected header. JWS signs the exact serialized payload bytes, so no
canonicalization scheme is involved.

```json
{
  "v": 1,
  "iss": "archive.zk.email",
  "iat": 1789000000,
  "record": {
    "id": "4711",
    "domain": "example.com",
    "selector": "mail2026",
    "value": "v=DKIM1; k=rsa; p=MIIB...",
    "source": "live_dns",
    "first_seen_at": "2026-06-01T00:00:00.000Z",
    "last_seen_at": "2026-07-15T08:00:00.000Z"
  }
}
```

- `v`: integer format version. Breaking payload changes bump it.
- `iss`: always `archive.zk.email`. Verifiers pin it, so it is the canonical
  name for the archive rather than a URL that has to resolve, and it has to
  outlive any particular deployment. (The proposal in the tracking issue used
  `archive.prove.email`, an alias for the same deployment; we settled on
  `archive.zk.email` before any statements were issued.)
- `iat`: issuance time, Unix epoch **seconds** (RFC 7519 NumericDate).
  Unanchored; see above.
- `record.id`: our internal record id as a string. Stable, opaque, and **not
  unique on its own**: a record observed through both channels produces two
  statements sharing an id. `(id, source)` identifies an observation.
- `record.domain` / `record.selector`: lowercase, exactly as in the DKIM `d=`
  and `s=` tags. Punycode for internationalized domains.
- `record.value`: the stored DKIM TXT record as-is, concatenated if DNS split
  it into multiple strings. **For `gcd_recovered` records there is no TXT record
  to store**, so the value is the synthesized `p=<base64 SPKI>` form. Compare
  the `p=` key bytes rather than the whole string.
- `record.first_seen_at` / `record.last_seen_at`: RFC 3339 UTC with a `Z`
  suffix, for that channel only.

Records stored as the literal value `p=` are excluded, matching `/api/key`.
Note this is an exact-value match, not a parse: a revocation published as
`v=DKIM1; p=` is stored and attested like any other record, with an empty key.
Check the `p=` tag yourself rather than relying on the record being absent.

**Immutability.** Statements are snapshots. A later statement for the same
record may carry a later `last_seen_at`; earlier statements remain valid. We
never retract one.

## Endpoints

### `GET /api/key/statement?domain=<d>&selector=<s>`

Returns a JSON array of compact JWS strings, one per stored key value per
_signable_ channel, so rotation history is preserved and the consumer picks the
entry whose key matches the signature being checked. An array entry is a bare
string.

Only `live_dns` is signable today, so a record observed solely via
`gcd_recovered` yields no statement and the array can come back empty for a pair
that `/api/key` does return. See
[Provenance](#provenance-two-channels-never-blended) for why. Read the
`source` claim rather than assuming a channel.

Unlike `/api/key`, the selector is **required**: a statement attests one
specific observation, and a domain-wide dump would sign an unbounded set on a
single request.

A single response is capped at 200 records (the most recent by first-seen),
because each one costs a signature per channel. Every response carries
`X-Total-Records`, and `X-Records-Truncated: true` when the cap was hit, so a
truncated rotation history never reads as a complete one. No real pair comes
close to the cap.

Returns `503 signing_unavailable` if the deployment has no signing key
configured. There is deliberately no unsigned fallback. A pair with no
attributable observation returns `200 []` instead, since it never reaches the
signer.

```console
$ curl 'https://archive.zk.email/api/key/statement?domain=example.com&selector=mail2026'
["eyJhbGciOiJFZERTQSIsImtpZCI6...", "eyJhbGciOiJFZERTQSIsImtpZCI6..."]
```

### `GET /.well-known/dkim-archive-jwks.json`

The verification keys, as a JWKS. Mirrored in this repo at
[`src/lib/archive-statement-jwks.json`](../src/lib/archive-statement-jwks.json)
so you can pin it from git; the endpoint is served from that same committed
file, so the URL and the mirror cannot drift.

**The set is append-only.** Rotation adds a `kid` and never removes one, so
statements signed by a retired key stay verifiable forever. It is not rate limited,
because verifying evidence you already hold must not depend on a quota.

### `GET /api/key?domain=<d>[&selector=<s>]`

The plain-JSON lookup carries the same provenance data, unsigned. Alongside the
existing fields each record now has:

- `id`: the same record id statements carry, as a JSON integer here and a
  string in the JWS payload.
- `observations`: at most one entry per channel, each
  `{ source, firstSeenAt, lastSeenAt }` with RFC 3339 UTC times.

The top-level `firstSeenAt` / `lastSeenAt` are the **union across channels**,
kept for backward compatibility and display. They deliberately mix provenance,
so do not bound key validity on them. Use `observations`.

## Verifying

The reference consumer is
[kysigned's `archiveStatement.ts`](https://github.com/kychee-com/kysigned/blob/main/src/bundle/archiveStatement.ts).
Statements from a running instance were verified against it directly, fetching
the key set from the well-known URL exactly as a consumer would: envelope,
algorithm allowlist, `kid` resolution, field names, `iat` integrality, the
RFC 3339 `Z` form, and every reject class.

That run was manual. The committed self-check (`pnpm statement:check`)
**restates** the reference verifier's rules rather than importing it, so it can
only catch a divergence from the rules as transcribed, not from their code as it
evolves. Any stock JOSE library works:

```ts
import { compactVerify, decodeProtectedHeader, importJWK } from 'jose';

const jwks = await fetch(
  'https://archive.zk.email/.well-known/dkim-archive-jwks.json'
).then((r) => r.json());

const { alg, kid } = decodeProtectedHeader(jws);
if (alg !== 'EdDSA' && alg !== 'ES256') throw new Error('unsupported alg');

const jwk = jwks.keys.find((k) => k.kid === kid);
if (!jwk) throw new Error('unknown key');

const { payload } = await compactVerify(jws, await importJWK(jwk, alg), {
  algorithms: [alg],
});
const statement = JSON.parse(new TextDecoder().decode(payload));
```

Fail closed: reject any `alg` outside the allowlist **before** touching key
material (this is what blocks `alg: none` and HS-confusion), resolve the key by
`kid` from the pinned set rather than trusting anything embedded in the token,
and re-check the payload shape after verifying the signature.

## Freshness

- **An existing `(domain, selector)`**: statements are signed on demand from
  stored data. There is no queue and no pipeline delay.
- **`POST /api/dsp` for a new pair**: the DNS fetch and record write happen
  synchronously in the request, so a statement is issuable as soon as it
  returns `201`.
- **Read caching**: lookups go through a 30-minute in-process cache, which
  every write path invalidates for the affected pair. The cache is per
  instance, though, so across a multi-instance deployment a window bumped on
  one instance can take up to 30 minutes to appear in statements signed by
  another. `first_seen_at` is unaffected; only a very recent `last_seen_at`
  can lag.
- **`POST /api/dsp` for a known pair**: this refreshes from DNS only if the
  pair has not been refreshed in the last hour (`refreshKeysFromDns`). So for a
  provider that rotates keys under a reused selector, a new key can be up to an
  hour stale. If you need a guaranteed-fresh observation at signing time, this
  is the one place to plan around.

## Operating the signing key

```console
$ pnpm statement:genkey                 # mint a key
$ pnpm statement:check                  # self-check the format end to end
$ pnpm statement:check --domain example.com --selector mail2026
```

`pnpm statement:check` also runs in CI, without a key configured, where it signs
with an ephemeral one.

The ceremony, in order (**publish before you sign**):

1. `pnpm statement:genkey` prints a public and a private JWK.
2. Append the **public** JWK to `src/lib/archive-statement-jwks.json`, commit,
   and deploy.
3. Set the **private** JWK as `ARCHIVE_STATEMENT_SIGNING_JWK` in the
   deployment's secret store.

The signer refuses to sign under a `kid` that is absent from the published set,
and additionally checks that the key material matches the published entry, not
just the name. Kids are date-stamped by default, so regenerating on the same day
reuses one; without the material check that would mint statements which verify
as `bad-signature` and only surface years later. Getting the order wrong now
fails loudly instead.

Never delete a key from the published set: consumers archive statements for
years, and removing a `kid` retroactively invalidates every statement it signed.

## Deploying the schema change

The migration adds four nullable columns and nothing else, so it is
metadata-only and effectively instant. The attribution is a separate, batched,
re-runnable step:

```console
$ pnpm prisma migrate deploy
$ pnpm backfill:observation-channels --dry-run   # report what would change
$ pnpm backfill:observation-channels
```

The backfill builds its own supporting index `CONCURRENTLY` on first run. Until
it has run, the per-channel columns are NULL and records simply yield no signed
observation, which is the intended fail-closed state rather than a wrong one.

## Legacy records

Before the per-channel split, the GCD callback matched records by `keyData`,
the same normalized SPKI for a key scraped from DNS and one recovered from
signatures, and widened `firstSeenAt` / `lastSeenAt` with the source emails'
dates. A key we had only ever seen in DNS could therefore carry a window partly
made of email timestamps.

The migration
(`prisma/migrations/20260812120000_add_per_source_observation_times`) only adds
the columns; the attribution runs out-of-band via
`pnpm backfill:observation-channels`, which splits the history apart:

- Records the GCD path created → the whole window is GCD's.
- Records GCD never touched → the whole window is DNS's.
- Contaminated records → the GCD window is recovered exactly from the linked
  email signatures, and a DNS bound is kept only where it provably lies outside
  it. Where a bound is not provable we fall back to the other provable bound
  rather than guessing; where neither is, both are left unknown and the record
  yields no `live_dns` statement until DNS observes it again.

The upshot: a recovered `live_dns` window may be **narrower** than reality, but
never wider. Erring narrow rejects some genuine old signatures; erring wide
would vouch for a key we never actually saw published.
