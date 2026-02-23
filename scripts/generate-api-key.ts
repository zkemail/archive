#!/usr/bin/env ts-node
/**
 * Generate and register a new API key for a client.
 *
 * Usage:
 *   npx ts-node scripts/generate-api-key.ts --name <client-name> [--rate-limit <req/sec>]
 *
 * Example:
 *   npx ts-node scripts/generate-api-key.ts --name kapwing --rate-limit 5000
 *
 * The script prints the raw API key to stdout. This is the only time it is
 * visible — share it with the client securely. The database only stores a
 * SHA-256 hash.
 */

import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'crypto';
import { Pool } from 'pg';

import { PrismaClient } from '../src/generated/prisma/client';

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(): { name: string; rateLimit: number } {
  const args = process.argv.slice(2);
  let name: string | undefined;
  let rateLimit = 1000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === '--rate-limit' && args[i + 1]) {
      rateLimit = parseInt(args[++i], 10);
      if (isNaN(rateLimit) || rateLimit <= 0) {
        console.error('--rate-limit must be a positive integer');
        process.exit(1);
      }
    }
  }

  if (!name) {
    console.error(
      'Usage: ts-node scripts/generate-api-key.ts --name <name> [--rate-limit <req/sec>]'
    );
    process.exit(1);
  }

  return { name, rateLimit };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { name, rateLimit } = parseArgs();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Generate a cryptographically random 32-byte key, base64url-encoded
    const rawKey = crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    await prisma.apiKey.create({
      data: {
        keyHash,
        name,
        rateLimit,
        isActive: true,
      },
    });

    console.log(`\nAPI key created for client: ${name}`);
    console.log(`Rate limit: ${rateLimit} req/sec`);
    console.log(
      `\nRaw API key (share securely — this is the only time it will be shown):`
    );
    console.log(`\n  ${rawKey}\n`);
    console.log(`Clients should send it as: x-api-key: ${rawKey}`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      console.error(`Error: a key with name "${name}" already exists.`);
    } else {
      console.error('Failed to create API key:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
