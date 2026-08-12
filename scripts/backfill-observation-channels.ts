// One-off backfill for the per-channel observation columns on DkimRecord
// (REG-735): dnsFirstSeenAt / dnsLastSeenAt and gcdFirstSeenAt / gcdLastSeenAt.
//
// The 20260812120000_add_per_source_observation_times migration adds the four
// columns and nothing else, on purpose: Prisma runs migrations in a
// transaction, so an in-migration backfill would hold ACCESS EXCLUSIVE on
// DkimRecord for as long as it took to rewrite 1.48M rows. The app pool's
// statement_timeout is 90s, so blocked reads would 5xx rather than wait, and
// build:deploy runs migrate deploy inline, putting that on the deploy path.
// This script does the same attribution in bounded batches that commit as they
// go, so no statement holds a lock longer than one batch.
//
// Attribution, not guesswork. Each record's window is assigned to the channel
// that can be shown to have produced it:
//
//   phase 1  records the GCD path created          -> the window is GCD's in full
//   phase 2  contaminated records (DNS-created,    -> GCD window recovered exactly
//            later widened by a GCD recovery)         from the linked EmailSignature
//                                                     timestamps; a DNS bound kept
//                                                     only where it provably lies
//                                                     outside that window
//   phase 3  records GCD never touched             -> the window is DNS's in full
//
// Where a bound is not provable we do not guess: phase 2 falls back to the
// other provable bound, and where neither is provable it leaves both NULL and
// the record yields no live_dns statement until DNS observes it again. So a
// reconstructed live-DNS window is never wider than the truth, only narrower.
// Erring narrow rejects some genuine old signatures; erring wide would vouch
// for a key we never saw published.
//
// Idempotent. Every phase is gated on the target columns still being NULL, so
// re-running only touches rows it has not already attributed. Safe to
// interrupt and resume.
//
// Usage:
//   pnpm backfill:observation-channels [--batch-size 10000] [--dry-run]

import 'dotenv/config';

import { Pool } from 'pg';

// Bounds a single UPDATE's row lock and WAL footprint. 10k rows keeps each
// batch well inside the 90s statement_timeout with room to spare.
const DEFAULT_BATCH_SIZE = 10_000;

// The union columns are not guaranteed ordered: production holds 257 rows
// where lastSeenAt sits fractionally before firstSeenAt, a clock artefact from
// a 2024-05-14 import. Copied verbatim those become an inverted per-channel
// window, and a signed statement whose first_seen_at is after its last_seen_at
// is malformed evidence that the reference verifier would still accept, since
// it checks RFC 3339 form and not ordering. Every phase therefore normalises
// with LEAST/GREATEST rather than assuming the stored order. Both values are
// real observation instants, so [min, max] is the honest window, and
// LEAST/GREATEST ignore NULLs so a NULL lastSeenAt still collapses to a
// single-instant window.
//
// Records whose union firstSeenAt predates this are treated as corrupt rather
// than early. The pre-fix GCD callback turned a missing email Date header into
// `new Date(null!)` -> the Unix epoch, and copying such a value into a
// per-channel column would launder it into signed evidence claiming we saw a
// key in 1970. Production currently has zero rows below this floor (earliest
// firstSeenAt is 2008-03-22), so this is insurance, not a live repair.
const SANITY_FLOOR = '1990-01-01';

type Args = { batchSize: number; dryRun: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let batchSize = DEFAULT_BATCH_SIZE;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--batch-size' && argv[i + 1]) {
      batchSize = parseInt(argv[++i], 10);
      if (isNaN(batchSize) || batchSize <= 0) {
        console.error('--batch-size must be a positive integer');
        process.exit(1);
      }
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { batchSize, dryRun };
}

const log = (message: string) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

async function main() {
  const { batchSize, dryRun } = parseArgs();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    // Generous but finite. A single batch should be well under this; hitting
    // it means the batch size is too large for the instance.
    statement_timeout: 300_000,
    application_name: 'reg735-backfill',
  });

  try {
    log(
      `starting observation-channel backfill (batch size ${batchSize}${dryRun ? ', DRY RUN' : ''})`
    );

    // No supporting index is built, and none is needed.
    //
    // EmailPairGcdResult.dkimRecordId carries a foreign key without an index
    // (PostgreSQL does not index FK columns automatically), which looks like it
    // should make the phase-2 join and phase-3 anti-join expensive. It does
    // not: the table holds 901 rows, so the planner sorts or hashes the whole
    // thing. Measured on production, the phase-3 batch selection plans as a
    // merge anti-join off the existing primary key and returns in ~102ms, and
    // an unbounded count of the same predicate takes ~1.5s.
    //
    // An earlier version of this script created the index first. That was
    // justified by a probe that ran past 300s, but the probe stacked three
    // correlated aggregates into one statement and was not the shape anything
    // here runs. The index also required table ownership, which the
    // application's database role does not have, so it turned a script that
    // works into one that fails on its first statement.

    // ── Phase 1: records the GCD path created ───────────────────────────────
    // Their whole window came from email timestamps, so it is GCD's in full and
    // there is no DNS observation to attribute. The sanity floor keeps an
    // epoch-corrupted row out of the signed columns entirely.
    //
    // `source` records how a key first entered, not everything that happened
    // afterwards, so in principle a later live-DNS sighting could have widened
    // one of these windows and would then be misattributed to GCD. The
    // `dnsFirstSeenAt IS NULL` guard closes that. The only way a GCD-created
    // row has dns* set is a DNS refresh landing between the migration and this
    // script, and such a row keeps the DNS window that refresh gave it and
    // simply gets no GCD claim: phase 2 does not pick it up either, since it
    // only considers non-GCD-sourced records. Silence on the GCD side is the
    // conservative outcome, and the next recovery for that key sets gcd*
    // properly through the callback.
    //
    // Measured on production before relying on this: of 392 GCD-created
    // records, none had been re-observed in the last 90 days, and their stored
    // `value` is the bare `k=rsa; p=…` form the batch importer wrote rather
    // than a `v=DKIM1; …` TXT record, so the DNS path (which matches on exact
    // `value`) could not have matched them. Where the union window did start
    // earlier than the linked signatures could prove (7 rows), the gap traces
    // to an earlier GCD batch run, not a DNS sighting: no row's union window
    // ended later than its links.
    const phase1 = await pool.query(
      `
      ${dryRun ? 'SELECT count(*) AS count FROM "DkimRecord" WHERE' : 'UPDATE "DkimRecord" SET "gcdFirstSeenAt" = LEAST("firstSeenAt", "lastSeenAt"), "gcdLastSeenAt" = GREATEST("firstSeenAt", "lastSeenAt") WHERE'}
        source LIKE 'public_key_gcd%'
        AND "gcdFirstSeenAt" IS NULL
        AND "dnsFirstSeenAt" IS NULL
        AND "firstSeenAt" > $1::timestamp
    `,
      [SANITY_FLOOR]
    );
    log(
      `phase 1 (GCD-created): ${dryRun ? phase1.rows[0].count : phase1.rowCount} rows`
    );

    // ── Phase 2: contaminated records ───────────────────────────────────────
    // DNS-created, later widened by a GCD recovery. Recover the GCD window
    // exactly from the linked email signatures (the same timestamps the
    // callback used), then keep a DNS bound only where it provably lies OUTSIDE
    // that window, which is the only case where the stored value cannot have
    // come from GCD.
    const phase2Sql = `
      WITH gcd_bounds AS (
        SELECT g."dkimRecordId"                              AS record_id,
               MIN(LEAST(sa."timestamp", sb."timestamp"))    AS gcd_first,
               MAX(GREATEST(sa."timestamp", sb."timestamp")) AS gcd_last
        FROM "EmailPairGcdResult" g
        JOIN "EmailSignature" sa ON sa.id = g."emailSignatureA_id"
        JOIN "EmailSignature" sb ON sb.id = g."emailSignatureB_id"
        WHERE g."dkimRecordId" IS NOT NULL
          AND sa."timestamp" IS NOT NULL
          AND sb."timestamp" IS NOT NULL
        GROUP BY g."dkimRecordId"
      ),
      attributed AS (
        SELECT r.id,
               b.gcd_first,
               b.gcd_last,
               CASE WHEN r."firstSeenAt" < b.gcd_first
                    THEN r."firstSeenAt" END AS dns_first_exact,
               CASE WHEN COALESCE(r."lastSeenAt", r."firstSeenAt") > b.gcd_last
                    THEN COALESCE(r."lastSeenAt", r."firstSeenAt") END AS dns_last_exact
        FROM "DkimRecord" r
        JOIN gcd_bounds b ON b.record_id = r.id
        WHERE (r.source IS NULL OR r.source NOT LIKE 'public_key_gcd%')
          AND r."gcdFirstSeenAt" IS NULL
          AND r."firstSeenAt" > $1::timestamp
          -- Fail closed on records whose GCD linkage includes any pair we
          -- cannot date. Their union window carries a contribution the
          -- gcd_bounds CTE cannot see, so "outside the GCD window" would be
          -- measured against an incomplete window and could hand a DNS bound
          -- a value GCD actually produced.
          AND NOT EXISTS (
            SELECT 1 FROM "EmailPairGcdResult" g2
            LEFT JOIN "EmailSignature" s2a ON s2a.id = g2."emailSignatureA_id"
            LEFT JOIN "EmailSignature" s2b ON s2b.id = g2."emailSignatureB_id"
            WHERE g2."dkimRecordId" = r.id
              AND (s2a."timestamp" IS NULL OR s2b."timestamp" IS NULL)
          )
      )
    `;

    if (dryRun) {
      const preview = await pool.query(
        `${phase2Sql} SELECT
        COUNT(*)                                                          AS total,
        COUNT(*) FILTER (WHERE dns_first_exact IS NOT NULL
                           AND dns_last_exact IS NOT NULL)                AS both_bounds,
        COUNT(*) FILTER (WHERE dns_first_exact IS NULL
                           AND dns_last_exact IS NULL)                    AS neither_bound
        FROM attributed`,
        [SANITY_FLOOR]
      );
      log(`phase 2 (contaminated): ${JSON.stringify(preview.rows[0])}`);
    } else {
      const phase2 = await pool.query(
        `${phase2Sql}
        UPDATE "DkimRecord" r
        SET "gcdFirstSeenAt" = a.gcd_first,
            "gcdLastSeenAt"  = a.gcd_last,
            -- Merge with whatever DNS has already recorded rather than
            -- replacing it. A DNS refresh landing between the migration and
            -- this script leaves a real live-DNS observation here, and an
            -- unconditional assignment wiped it out when neither reconstructed
            -- bound was provable: the one kind of evidence this whole change
            -- exists to protect. LEAST/GREATEST ignore NULLs in PostgreSQL, so
            -- this also covers "only one bound provable" (the window collapses
            -- to that instant) and "nothing to merge" (the column keeps its
            -- existing value, or stays NULL).
            -- Both bounds are drawn from the SAME set of instants, so
            -- first <= last holds by construction rather than by argument. An
            -- earlier version took first from {existing first, reconstructed}
            -- and last from {existing last, reconstructed}; those differ, and
            -- an already-inverted existing pair would have stayed inverted.
            -- Nothing can write such a pair today, but the ordering guarantee
            -- should not depend on that remaining true.
            "dnsFirstSeenAt" = LEAST(r."dnsFirstSeenAt", r."dnsLastSeenAt", a.dns_first_exact, a.dns_last_exact),
            "dnsLastSeenAt"  = GREATEST(r."dnsFirstSeenAt", r."dnsLastSeenAt", a.dns_first_exact, a.dns_last_exact)
        FROM attributed a
        WHERE a.id = r.id`,
        [SANITY_FLOOR]
      );
      log(`phase 2 (contaminated): ${phase2.rowCount} rows`);
    }

    // ── Phase 3: records GCD never touched ──────────────────────────────────
    // The bulk of the table. Batched by primary key so each statement takes a
    // bounded row lock and commits on its own, rather than one 1.48M-row
    // transaction. Gated on dnsFirstSeenAt IS NULL, so a resumed run skips
    // everything already done and the cursor never has to be persisted. The
    // sanity floor applies here as well: a pre-1990 union timestamp is corrupt,
    // and copying it into dnsFirstSeenAt would launder it into a signed claim
    // that we saw the key in DNS decades before DKIM existed.
    if (dryRun) {
      const remaining = await pool.query(
        `
        SELECT COUNT(*) AS count FROM "DkimRecord" r
        WHERE (r.source IS NULL OR r.source NOT LIKE 'public_key_gcd%')
          AND r."dnsFirstSeenAt" IS NULL
          AND r."firstSeenAt" > $1::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM "EmailPairGcdResult" g WHERE g."dkimRecordId" = r.id
          )
      `,
        [SANITY_FLOOR]
      );
      log(
        `phase 3 (pure DNS): ${remaining.rows[0].count} rows would be updated`
      );
    } else {
      let total = 0;
      let batches = 0;

      for (;;) {
        const batch = await pool.query(
          `
          WITH todo AS (
            SELECT r.id FROM "DkimRecord" r
            WHERE (r.source IS NULL OR r.source NOT LIKE 'public_key_gcd%')
              AND r."dnsFirstSeenAt" IS NULL
              AND r."firstSeenAt" > $2::timestamp
              AND NOT EXISTS (
                SELECT 1 FROM "EmailPairGcdResult" g WHERE g."dkimRecordId" = r.id
              )
            ORDER BY r.id
            LIMIT $1
          )
          UPDATE "DkimRecord" r
          SET "dnsFirstSeenAt" = LEAST(r."firstSeenAt", r."lastSeenAt"),
              "dnsLastSeenAt"  = GREATEST(r."firstSeenAt", r."lastSeenAt")
          FROM todo
          WHERE todo.id = r.id
        `,
          [batchSize, SANITY_FLOOR]
        );

        const n = batch.rowCount ?? 0;
        if (n === 0) break;

        total += n;
        batches++;
        if (batches % 10 === 0) log(`phase 3 (pure DNS): ${total} rows so far`);
      }

      log(`phase 3 (pure DNS): ${total} rows in ${batches} batches`);
    }

    // ── Report what remains unattributed ────────────────────────────────────
    // Expected to be small: records whose GCD linkage carries no usable email
    // timestamps, plus anything below the sanity floor. These yield no signed
    // observation until DNS sees them again, which is the intended outcome.
    const leftover = await pool.query(`
      SELECT COUNT(*) AS count FROM "DkimRecord"
      WHERE "dnsFirstSeenAt" IS NULL AND "gcdFirstSeenAt" IS NULL
    `);
    log(
      `unattributed after backfill: ${leftover.rows[0].count} rows (these yield no statement)`
    );

    log('done');
  } catch (error) {
    console.error('backfill failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill threw:', err);
  process.exit(1);
});
