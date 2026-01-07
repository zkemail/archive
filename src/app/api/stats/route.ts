import { NextResponse } from 'next/server';

import { getArchiveStats, refreshArchiveStats } from '@/lib/db';

// GET - read cached stats (instant)
export async function GET() {
  const stats = await getArchiveStats();
  return NextResponse.json(stats);
}

// POST - refresh stats (heavy, call via cron)
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await refreshArchiveStats();
  return NextResponse.json(stats);
}
