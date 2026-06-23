// Standalone archive-stats refresh script. Intended to be run on a Render
// Cron Job, the same way scripts/update-jwks.ts is.
//
// What it does:
//   1. Runs refreshArchiveStats() (exact COUNT(DISTINCT) over
//      DomainSelectorPair + COUNT(*) of DkimRecord).
//   2. Upserts the result into the StatsCache table (id=1), which the
//      landing page / /api/stats GET reads.
//
// Why this exists: the homepage stats are served from the StatsCache
// snapshot and are ONLY updated when something triggers a refresh. Without
// this cron the numbers freeze at whatever last wrote them. (They were
// stuck at 0 because nothing ever ran the refresh.)
//
// Usage:
//   pnpm stats:refresh         uses DATABASE_URL from .env
//
// Render Cron Job setup (mirrors archive-new-jwks-cron):
//   - Service type: Cron Job
//   - Repo: zkemail/archive
//   - Branch: main
//   - Schedule: hourly ("0 * * * *")
//   - Build command: pnpm install --frozen-lockfile && pnpm prisma generate
//   - Run command:   pnpm stats:refresh
//   - Env vars:      DATABASE_URL (same value as the archive-new web service)

import 'dotenv/config';

import { refreshArchiveStats } from '../src/lib/db';

async function main() {
  console.log(`[${new Date().toISOString()}] starting archive stats refresh`);

  const stats = await refreshArchiveStats();

  // refreshArchiveStats always returns the computed values (it throws on a
  // query error, which is caught below and fails the run). A sanity guard:
  // an all-zero result on a populated archive almost certainly means the
  // query hit the wrong DB / empty tables, so fail loudly rather than
  // silently caching zeros.
  if (
    stats.domainSelectorPairs === 0 &&
    stats.dkimKeys === 0 &&
    stats.uniqueDomains === 0
  ) {
    console.error(
      'Stats refresh produced all zeros — refusing to treat as success. Check DATABASE_URL / tables.'
    );
    process.exit(1);
  }

  console.log(
    `[${new Date().toISOString()}] stats refresh OK: ` +
      `domains=${stats.uniqueDomains} selectors=${stats.uniqueSelectors} ` +
      `dsp=${stats.domainSelectorPairs} keys=${stats.dkimKeys}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('stats refresh threw:', err);
  process.exit(1);
});
