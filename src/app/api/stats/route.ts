import { NextResponse } from 'next/server';

import { serverError } from '@/lib/api-response';
import { getArchiveStats, refreshArchiveStats } from '@/lib/db';
import { logger } from '@/lib/logger';

// GET - read cached stats (instant)
export async function GET() {
  const stats = await getArchiveStats();
  return NextResponse.json(stats);
}

// POST - refresh stats (heavy, call via cron)
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await refreshArchiveStats();
    return NextResponse.json(stats);
  } catch (error) {
    logger.error('stats_refresh_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
