import { type NextRequest, NextResponse } from 'next/server';

import { badRequest, serverError } from '@/lib/api-response';
import { prisma, updateDspTimestamp } from '@/lib/db';
import { logger } from '@/lib/logger';
import { guessSelectors } from '@/lib/selectorGuesser';
import { fetchAndStoreDkimDnsRecord } from '@/lib/utilsServer';

// Ported from zkemail/archive.zk.email:src/app/api/batch_update/route.ts.
// Polled every minute by a GCE-hosted cron (see REG-717).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batchSizeParam = request.nextUrl.searchParams.get('batch_size');
  const batchSize = Number(batchSizeParam || '10');
  if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 1000) {
    return badRequest('batch_size must be a positive integer <= 1000');
  }

  try {
    const oneDayAgo = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const dsps = await prisma.domainSelectorPair.findMany({
      where: { lastRecordUpdate: { lte: oneDayAgo } },
      orderBy: { lastRecordUpdate: 'asc' },
      take: batchSize,
    });

    logger.info('batch_update_start', {
      requested: batchSize,
      found: dsps.length,
    });

    const addedAlternatives: { domain: string; selector: string }[] = [];
    for (const dsp of dsps) {
      try {
        await fetchAndStoreDkimDnsRecord(dsp);
        const now = new Date();
        await updateDspTimestamp(dsp, now);
        addedAlternatives.push(
          ...(await guessSelectors(dsp.domain, dsp.selector, now))
        );
      } catch (error) {
        logger.error('batch_update_dsp_failed', {
          domain: dsp.domain,
          selector: dsp.selector,
          error: error instanceof Error ? error.message : String(error),
        });
        // Match the legacy behavior: abort the batch on first per-DSP failure
        // so the cron retries the same window next run.
        throw error;
      }
    }

    return NextResponse.json(
      { updatedRecords: dsps, addedAlternatives },
      { status: 200 }
    );
  } catch (error) {
    logger.error('batch_update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
