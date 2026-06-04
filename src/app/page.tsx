import type { Metadata } from 'next';

import { getArchiveStats } from '@/lib/db';

import HomeClient from './HomeClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'DKIM Archive | ZK Email' },
};

export default async function Home() {
  const stats = await getArchiveStats();
  return <HomeClient stats={stats} />;
}
