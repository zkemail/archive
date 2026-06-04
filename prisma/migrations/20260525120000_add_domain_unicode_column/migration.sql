-- Adds a denormalized Unicode form of `domain` to DomainSelectorPair so
-- substring searches in non-Latin scripts (Cyrillic, Thai, Japanese, etc.)
-- can match partial queries. Punycode encoding is not prefix-preserving;
-- without a separate column, searching for "прайм" can never find the
-- row stored as `xn--19-6kc0bpph.xn--p1ai`. See REG-711.
--
-- For ASCII domains: domainUnicode equals domain. For IDN domains: it
-- holds the decoded Unicode label (e.g. `прайм19.рф`). The initial UPDATE
-- below seeds every row with `domain`; a separate Node.js backfill
-- script (`scripts/backfill-domain-unicode.ts`) follows up to decode IDN
-- rows. The application's write path is also updated to populate the
-- column correctly on new inserts.
--
-- The index is added without CONCURRENTLY because Prisma migrations run
-- inside a transaction. For prod we apply CONCURRENTLY manually
-- out-of-band (same pattern used for the original pg_trgm index in
-- REG-701); the `IF NOT EXISTS` clause makes this file a no-op in that
-- case. On fresh setups the regular CREATE INDEX runs and briefly locks
-- the table — fine when there is no traffic.

ALTER TABLE "DomainSelectorPair"
  ADD COLUMN IF NOT EXISTS "domainUnicode" TEXT NOT NULL DEFAULT '';

UPDATE "DomainSelectorPair"
  SET "domainUnicode" = domain
  WHERE "domainUnicode" = '';

CREATE INDEX IF NOT EXISTS idx_domain_selector_pair_domain_unicode_trgm
  ON "DomainSelectorPair" USING gin ("domainUnicode" gin_trgm_ops);
