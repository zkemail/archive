// One-off backfill for the `domainUnicode` column on DomainSelectorPair.
//
// Context: the 20260525120000_add_domain_unicode_column migration adds
// the column and seeds every row with `domainUnicode = domain`. That's
// correct for ASCII domains. For IDN domains (`xn--...`) it leaves the
// Punycode form in place, which means partial-IDN substring search
// (e.g. `прайм` finding `прайм19.рф`) still doesn't work for those
// rows. This script decodes each IDN row's Punycode form to its
// Unicode label and updates the column.
//
// Idempotent: re-running it is harmless. Only updates rows where
// `domain` looks like Punycode (`xn--*`) and `domainUnicode` is still
// the Punycode form (i.e. hasn't been decoded yet).
//
// Usage:
//   pnpm tsx scripts/backfill-domain-unicode.ts
//
// Or via package.json script if added.

import 'dotenv/config';

import { domainToUnicode } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../src/generated/prisma/client';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(
      `[${new Date().toISOString()}] starting domainUnicode backfill`
    );

    // Distinct IDN domains that still have their Punycode form sitting
    // in domainUnicode (i.e. haven't been decoded yet).
    const idnDomains = await prisma.domainSelectorPair.findMany({
      where: {
        domain: { startsWith: 'xn--', mode: 'insensitive' },
      },
      select: { domain: true, domainUnicode: true },
      distinct: ['domain'],
    });

    console.log(`Found ${idnDomains.length} distinct IDN domains.`);

    let domainsUpdated = 0;
    let rowsUpdated = 0;
    let skippedAlreadyDecoded = 0;
    let skippedDecoderFailed = 0;

    for (const row of idnDomains) {
      const decoded = domainToUnicode(row.domain) || row.domain;
      if (decoded === row.domain) {
        // Decoder returned the input unchanged. Means it's not a valid
        // Punycode label (unlikely but possible for hand-crafted data).
        // Skip; the row already has `domainUnicode = domain` which is
        // the best fallback we can offer.
        skippedDecoderFailed++;
        continue;
      }

      if (row.domainUnicode === decoded) {
        skippedAlreadyDecoded++;
        continue;
      }

      const result = await prisma.domainSelectorPair.updateMany({
        where: { domain: row.domain },
        data: { domainUnicode: decoded },
      });
      domainsUpdated++;
      rowsUpdated += result.count;
    }

    console.log(
      `[${new Date().toISOString()}] backfill complete: ${domainsUpdated} domains, ${rowsUpdated} rows updated; ${skippedAlreadyDecoded} already-decoded; ${skippedDecoderFailed} decoder-failed.`
    );
    process.exit(0);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill threw:', err);
  process.exit(1);
});
