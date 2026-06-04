// Standalone JWK refresh script. Intended to be run on a 5-minute Render
// Cron Job schedule, replacing the old archive's long-running background
// worker (archive.zk.email's src/util/cron.ts).
//
// What it does:
//   1. Fetches Google's current x509 cert + JWKS (via lib/db updateJWKeySet).
//   2. Compares to the latest row in the JsonWebKeySets table.
//   3. Inserts a new row if the cert changed, otherwise just bumps the
//      lastUpdated timestamp on the existing row.
//
// Witness.co integration is intentionally not ported: the team confirmed
// Witness is deprecated and nothing downstream consumes the on-chain
// witness timestamps anymore (see REG-702, REG-704).
//
// Usage:
//   pnpm jwks:update           uses DATABASE_URL from .env
//
// Render Cron Job setup:
//   - Service type: Cron Job
//   - Repo: zkemail/archive
//   - Branch: develop (or main, post-merge)
//   - Schedule: every 5 minutes (cron expression "*/5 * * * *")
//   - Build command: pnpm install --frozen-lockfile && pnpm prisma generate
//   - Run command:   pnpm jwks:update
//   - Env vars:      DATABASE_URL (same value as the archive-new web service)

import 'dotenv/config';

import { updateJWKeySet } from '../src/lib/db';

async function main() {
  console.log(`[${new Date().toISOString()}] starting JWK refresh`);

  const result = await updateJWKeySet();

  if (!result) {
    // updateJWKeySet swallows errors internally and logs via the app
    // logger. Treat a missing return value as a failure so Render marks
    // the cron run as failed (visible in dashboard, alertable).
    console.error('JWK refresh returned no result. Check app logs.');
    process.exit(1);
  }

  console.log(
    `[${new Date().toISOString()}] JWK refresh OK (row id=${result.id}, lastUpdated=${result.lastUpdated.toISOString()})`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('JWK refresh threw:', err);
  process.exit(1);
});
