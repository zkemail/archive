-- Per-channel observation windows for DkimRecord (REG-735).
--
-- Until now a record carried a single (firstSeenAt, lastSeenAt) pair fed by two
-- very different channels:
--
--   * live DNS:  fetchAndStoreDkimDnsRecord() matches an existing record by
--                 `value` and bumps lastSeenAt to the fetch time.
--   * GCD:       the /api/gcd_result_callback matches by `keyData`, which also
--                 matches DNS-sourced records, and widened firstSeenAt /
--                 lastSeenAt with the *source emails'* dates.
--
-- So a key we only ever saw in DNS could silently have its window stretched by
-- email timestamps. Consumers that bound a key's validity on "when was this
-- actually published in DNS" were being handed a mixed number with no way to
-- tell. Split the two channels apart so each carries its own window and neither
-- can modify the other's.
--
-- The union (firstSeenAt, lastSeenAt) is kept as-is so the UI and the existing
-- /api/key response are unchanged.
--
-- DDL ONLY. The backfill deliberately does NOT live here.
--
-- Prisma runs each migration inside a transaction, so any UPDATE placed in this
-- file would hold the ALTER TABLE's ACCESS EXCLUSIVE lock on DkimRecord for as
-- long as it took to rewrite 1.48M rows. The app pool sets
-- statement_timeout=90s (src/lib/db.ts), so blocked reads would 5xx rather than
-- wait, and `build:deploy` runs `prisma migrate deploy` inline, putting that
-- outage squarely on the deploy path.
--
-- NOTE FOR DEPLOY: every table in this database is owned by cloudsqlsuperuser
-- and the application role (render) is a member of no role, so it cannot run
-- ALTER TABLE. This migration must be applied with an owning role. The backfill
-- script needs only SELECT and UPDATE and runs fine as the application role.
--
-- Adding nullable columns with no default is metadata-only on PostgreSQL 11+,
-- so this file on its own is effectively instant. The attribution work lives in
-- scripts/backfill-observation-channels.ts, which batches, commits as it goes,
-- and is re-runnable. Run it after deploying this migration. Until it does, the new columns stay NULL and a
-- record simply yields no signed observation, which is the intended fail-closed
-- state rather than a wrong one.
--
-- IF NOT EXISTS mirrors 20260521151000_add_pg_trgm_index: it keeps the file a
-- no-op where the columns were already added out-of-band, and keeps a
-- partially-applied deploy re-runnable instead of wedging `migrate deploy`
-- behind a manual `migrate resolve`.

ALTER TABLE "DkimRecord"
  ADD COLUMN IF NOT EXISTS "dnsFirstSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dnsLastSeenAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gcdFirstSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gcdLastSeenAt"  TIMESTAMP(3);
