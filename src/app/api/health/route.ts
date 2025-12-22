import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { HealthCheckResponse } from '@/types/api';

// Force dynamic rendering for health checks
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Health check endpoint for monitoring and load balancer probes
 *
 * Returns:
 * - 200: All systems healthy
 * - 503: One or more systems unhealthy
 */
export async function GET(): Promise<NextResponse<HealthCheckResponse>> {
  const startTime = Date.now();

  const health: HealthCheckResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: false,
    },
  };

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = true;
  } catch (error) {
    health.status = 'unhealthy';
    logger.error('health_check_database_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Determine overall status
  const allChecksPass = Object.values(health.checks).every((check) => check);
  if (!allChecksPass) {
    health.status = 'unhealthy';
  }

  const responseTime = Date.now() - startTime;
  const statusCode = health.status === 'healthy' ? 200 : 503;

  logger.info('health_check_completed', {
    status: health.status,
    responseTimeMs: responseTime,
    checks: health.checks,
  });

  return NextResponse.json(health, {
    status: statusCode,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Response-Time': `${responseTime}ms`,
    },
  });
}
