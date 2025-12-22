import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { prisma, updateDspTimestamp } from '@/lib/db';
import { logger } from '@/lib/logger';
import { guessSelectors } from '@/lib/selector_guesser';
import { fetchAndStoreDkimDnsRecord } from '@/lib/utils_server';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    logger.warn('batch_update_unauthorized');
    return new Response('Unauthorized', { status: 401 });
  }

  const numRecords = Number(
    request.nextUrl.searchParams.get('batch_size') || '10'
  );

  try {
    const oneDayAgo = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const dsps = await prisma.domainSelectorPair.findMany({
      where: { lastRecordUpdate: { lte: oneDayAgo } },
      orderBy: { lastRecordUpdate: 'asc' },
      take: numRecords,
    });

    logger.info('batch_update_start', {
      recordCount: dsps.length,
      maxLimit: numRecords,
    });

    const addedAlternatives = [];
    for (const dsp of dsps) {
      try {
        await fetchAndStoreDkimDnsRecord(dsp);
        const now = new Date();
        updateDspTimestamp(dsp, now);
        addedAlternatives.push(
          ...(await guessSelectors(dsp.domain, dsp.selector, now))
        );
      } catch (error) {
        logger.error('batch_update_dsp_error', {
          domain: dsp.domain,
          selector: dsp.selector,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    logger.info('batch_update_complete', {
      updatedRecords: dsps.length,
      addedAlternatives: addedAlternatives.length,
    });

    return NextResponse.json(
      { updatedRecords: dsps, addedAlternatives },
      { status: 200 }
    );
  } catch (error) {
    logger.error('batch_update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      error instanceof Error ? error.message : String(error),
      { status: 500 }
    );
  }
}
