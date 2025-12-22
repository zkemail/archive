import chalk from 'chalk';
import crypto from 'crypto';

import { Prisma } from '@/generated/prisma/client';

import {
  createGcdCalculationTask,
  GcdCalculationPayload,
} from './calculateGcdTask';
import { prisma } from './db';
import { logger } from './logger';
import {
  canonicalizeHeaders,
  computeCanonicalizedHeaderHash,
  encodeRsaPkcs1Digest,
  parseDkimSignature,
  selectSignedHeadersnew,
} from './utils';
import { type AddResult, pubKeyLength } from './utils_server';

export async function processAndStoreEmailSignature(
  headerStrings: string[][],
  dkimSignature: string,
  tags: Record<string, string>,
  timestamp: Date | null,
  addResult: AddResult,
  processResultBadSignatureError = false
) {
  logger.debug('process_email_signature_start', {
    domain: tags.d,
    selector: tags.s,
  });

  // Parse signature values for canonicalization
  const dkimSigsArrayParsed = parseDkimSignature(dkimSignature);

  // Parse header values for canonicalization
  const signedHeadersraw = tags.h;
  if (!signedHeadersraw) {
    logger.warn('dkim_missing_h_tag', { tags });
    return;
  }
  const signedHeadersArray = signedHeadersraw.split(':');
  const signedHeaders = selectSignedHeadersnew(
    headerStrings,
    signedHeadersArray
  );

  // Canonicalize header hash
  const headerCanonicalizationAlgorithm = tags.c
    ? tags.c.split('/')[0]
    : 'simple';
  const signed_data = canonicalizeHeaders(
    signedHeaders,
    headerCanonicalizationAlgorithm
  );

  // Canonicalize signature
  const canonicalised_signature = canonicalizeHeaders(
    dkimSigsArrayParsed,
    headerCanonicalizationAlgorithm
  );

  // Calculate the header hash
  const hashingAlgorithm = tags.a;
  const hashInstance = crypto.createHash(hashingAlgorithm.replace('rsa-', ''));
  computeCanonicalizedHeaderHash(
    hashInstance,
    signed_data,
    canonicalised_signature,
    headerCanonicalizationAlgorithm
  );
  const headerHash = hashInstance.digest('hex');

  const signingAlgorithm = tags.a?.toLowerCase() || 'rsa-sha256';
  if (
    signingAlgorithm !== 'rsa-sha256' &&
    signingAlgorithm !== 'rsa-sha1' &&
    signingAlgorithm !== 'rsa-sha512'
  ) {
    logger.warn('unsupported_signing_algorithm', { signingAlgorithm });
    return;
  }

  const domain = tags.d;
  const selector = tags.s;
  const dkimSignatureRaw = tags.b;
  if (!dkimSignatureRaw) {
    logger.warn('dkim_missing_b_tag', { tags });
    return;
  }

  // Insert or ignore email signature
  try {
    const result = await prisma.$executeRaw`
    INSERT INTO "EmailSignature" (
      domain, selector, "headerHash", "headerHashV2",
      "dkimSignature", timestamp, "signingAlgorithm", "canonInfo"
    )
    VALUES (
      ${domain}, ${selector}, ${headerHash}, ${headerHash},
      ${dkimSignatureRaw}, ${timestamp}, ${signingAlgorithm},
      ${'@zk-email/helpers@6.3.3'}
    )
    ON CONFLICT ("headerHashV2", "dkimSignature") DO NOTHING
  `;

    if (result === 0) {
      logger.info('email_signature_exists', { domain, selector });
      return {
        processResultError: 'headerHash and Signature already exist in DB',
      };
    } else {
      logger.info('email_signature_inserted', { domain, selector });
    }
  } catch (error) {
    logger.error('email_signature_insert_failed', {
      domain,
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // Check if we need to calculate GCD
  if (
    (!addResult.added && !addResult.already_in_db) ||
    processResultBadSignatureError
  ) {
    // Fetch future and past email signatures for the given domain and selector
    const [futureEmailSigs, pastEmailSigs] = await Promise.all([
      prisma.emailSignature.findMany({
        where: {
          domain: { equals: domain, mode: Prisma.QueryMode.insensitive },
          selector: { equals: selector, mode: Prisma.QueryMode.insensitive },
          timestamp: { gt: timestamp || undefined },
        },
        take: 2,
        orderBy: { timestamp: 'asc' },
      }),
      prisma.emailSignature.findMany({
        where: {
          domain: { equals: domain, mode: Prisma.QueryMode.insensitive },
          selector: { equals: selector, mode: Prisma.QueryMode.insensitive },
          timestamp: { lt: timestamp || undefined },
        },
        take: 2,
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    const dsps = [...futureEmailSigs, ...pastEmailSigs];
    logger.info('email_signatures_found', {
      domain,
      selector,
      count: dsps.length,
    });

    if (dsps.length === 0) {
      logger.warn('no_existing_dsps_for_gcd', { domain, selector });
      return {
        processResultError:
          "No existing DSPs found for domain,Can't check for GCD",
      };
    }

    // Calculate signature and encoded message digest for current email
    const signature1 = BigInt(
      `0x${Buffer.from(dkimSignatureRaw, 'base64').toString('hex')}`
    ).toString();
    const keySizeBytes = pubKeyLength(dkimSignatureRaw);
    const headerHashBuffer1 = Buffer.from(headerHash, 'hex');
    const encodedMessageDigest1 = encodeRsaPkcs1Digest(
      headerHashBuffer1,
      signingAlgorithm,
      keySizeBytes
    ).toString();

    // Loop through each found DSP to create a GCD calculation task
    const result = [];
    for (const dsp of dsps) {
      if (!dsp.dkimSignature || !dsp.headerHashV2) {
        logger.warn('skipping_dsp_missing_fields', { dspId: dsp.id });
        continue;
      }

      // Handle signing algorithm mismatch
      if (
        signingAlgorithm !==
        (dsp.signingAlgorithm?.toLowerCase() || 'rsa-sha256')
      ) {
        logger.warn('signing_algorithm_mismatch', {
          dspId: dsp.id,
          current: signingAlgorithm,
          dsp: dsp.signingAlgorithm,
        });
        continue;
      }

      // Calculate signature and encoded message digest for the DSP
      const signature2 = BigInt(
        `0x${Buffer.from(dsp.dkimSignature, 'base64').toString('hex')}`
      ).toString();
      const headerHashBuffer2 = Buffer.from(dsp.headerHashV2, 'hex');
      const encodedMessageDigest2 = encodeRsaPkcs1Digest(
        headerHashBuffer2,
        signingAlgorithm,
        keySizeBytes
      ).toString();
      const taskId = crypto.randomBytes(16).toString('hex');

      const timestamp1 =
        !dsp.timestamp || (timestamp && timestamp < dsp.timestamp)
          ? timestamp
          : dsp.timestamp;
      const timestamp2 =
        !dsp.timestamp || (timestamp && timestamp < dsp.timestamp)
          ? dsp.timestamp
          : timestamp;
      const metadata = {
        domain,
        selector,
        headerHash1: headerHash,
        dkimSignature1: dkimSignatureRaw,
        headerHash2: dsp.headerHashV2,
        dkimSignature2: dsp.dkimSignature,
        timestamp1,
        timestamp2,
        signingAlgorithm,
      };

      const payload: GcdCalculationPayload = {
        s1: signature1,
        s2: signature2,
        em1: encodedMessageDigest1,
        em2: encodedMessageDigest2,
        taskId,
        metadata,
      };

      const createGCDResult = await createGcdCalculationTask(payload);
      const createGCDResultwithDSP = {
        ...createGCDResult,
        domain,
        selector,
        taskId,
      };
      result.push(createGCDResultwithDSP);
      console.log(
        chalk.green(`Created GCD calculation task for DSP id ${dsp.id}.`)
      );
    }
    return result;
  }
}
