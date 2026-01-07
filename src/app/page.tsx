import { getArchiveStats } from '@/lib/db';

import HomeClient from './HomeClient';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const stats = await getArchiveStats();
  return <HomeClient stats={stats} />;
}
