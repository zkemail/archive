-- pg_trgm enables trigram-based GIN indexes for fast ILIKE substring
-- search. Without this index, autocomplete and search queries against
-- DomainSelectorPair.domain do a full sequential scan of ~1M rows
-- (15+ seconds in production); with it, the same queries drop to
-- single-digit milliseconds.
--
-- IF NOT EXISTS clauses make this safe on environments where the
-- extension and index were applied manually out-of-band (e.g.
-- prod-duplicate where we ran CREATE INDEX CONCURRENTLY directly to
-- avoid locking the table during the build).
--
-- CONCURRENTLY cannot run inside a transaction, so this migration
-- file omits it. On fresh setups the index build takes ~1-2 min on
-- 1M rows and briefly locks the table; on environments that already
-- have the index, both statements are no-ops.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_domain_selector_pair_domain_trgm
  ON "DomainSelectorPair" USING gin (domain gin_trgm_ops);
