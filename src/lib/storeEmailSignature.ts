import crypto from 'crypto';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

import {
  createGcdCalculationTask,
  GcdCalculationPayload,
} from './calculateGcdTask';
import { logger } from './logger';
import type { HeaderPair, SignatureEvidence } from './utils';
import {
  AddResult,
  canonicalizeHeaders,
  computeCanonicalizedHeaderHash,
  encodeRsaPkcs1Digest,
  parseDkimSignature,
  pubKeyLength,
  selectSignedHeadersNew,
} from './utilsServer';

// Version identifier for canonicalization tracking
const CANON_INFO_VERSION = '@zk-email/helpers@6.3.3';

export type ProcessResult = {
  signatureStatus: 'stored' | 'duplicate' | 'skipped';
  recoveryFailures: number;
};

export async function processAndStoreEmailSignature(
  headerStrings: HeaderPair[],
  dkimSignature: string,
  tags: Record<string, string>,
  timestamp: Date | null,
  addResult: AddResult,
  processResultBadSignatureError = false
): Promise<ProcessResult> {
  /*
	Basic run down of below Steps :-
	1. we will parse header and Signature values
	2. we will canonicalize the header and signature values
	3. we will find header hash for storage and Possibly GCD calculation
	*/

  // Signature values are parsed for canonicaization
  const dkimSigsArrayParsed = parseDkimSignature(dkimSignature);

  // Header values are parsed for canonicalization
  const signedHeadersRaw = tags.h;
  if (!signedHeadersRaw) {
    logger.debug('missing_h_tag', { domain: tags.d, selector: tags.s });
    return { signatureStatus: 'skipped', recoveryFailures: 0 };
  }
  const signedHeadersArray = signedHeadersRaw.split(':');
  const signedHeaders = selectSignedHeadersNew(
    headerStrings,
    signedHeadersArray
  );

  // canonicalize header hash
  const headerCanonicalizationAlgorithm = tags.c
    ? tags.c.split('/')[0]
    : 'simple';
  const signedData = canonicalizeHeaders(
    signedHeaders,
    headerCanonicalizationAlgorithm
  );

  // Canoniacalize signature
  const canonicalizedSignature = canonicalizeHeaders(
    dkimSigsArrayParsed,
    headerCanonicalizationAlgorithm
  );

  // Calculating the header hash
  const signingAlgorithm = tags.a?.toLowerCase() || '';
  if (!['rsa-sha256', 'rsa-sha1', 'rsa-sha512'].includes(signingAlgorithm)) {
    return { signatureStatus: 'skipped', recoveryFailures: 0 };
  }
  const hashingAlgorithm = signingAlgorithm;
  const hashInstance = crypto.createHash(hashingAlgorithm.replace('rsa-', ''));
  computeCanonicalizedHeaderHash(
    hashInstance,
    signedData,
    canonicalizedSignature,
    headerCanonicalizationAlgorithm
  );
  const headerHash = hashInstance.digest('hex');

  if (!tags.b) {
    logger.debug('missing_b_tag', { domain: tags.d, selector: tags.s });
    return { signatureStatus: 'skipped', recoveryFailures: 0 };
  }
  return storeSignatureEvidence(
    {
      domain: tags.d,
      selector: tags.s,
      headerHash,
      dkimSignature: tags.b,
      signingAlgorithm:
        signingAlgorithm as SignatureEvidence['signingAlgorithm'],
    },
    timestamp,
    addResult,
    processResultBadSignatureError
  );
}

// A submitted hash/signature is a recovery candidate, not proof of a valid
// DKIM email. Recovered keys must verify the signature against this digest.
export async function storeSignatureEvidence(
  evidence: SignatureEvidence,
  timestamp: Date | null,
  addResult: AddResult,
  processResultBadSignatureError = false
): Promise<ProcessResult> {
  const startTime = performance.now();
  const {
    domain,
    selector,
    headerHash,
    signingAlgorithm,
    dkimSignature: dkimSignatureRaw,
  } = evidence;
  /*
	Basic rundown of the steps below:
	1. Check if the hash and signature exist. If they do, we skip the rest of the processing and return early.
	2. If it doesn't exist, we directly store it in the DB.
	3. Check if the public key exists or we got it from DNS.
	4. If not, we query other pairs from database, if we find any we calculate the GCD else we return.
	*/

  const insertStart = performance.now();
  try {
    const result = await prisma.$executeRaw`
		INSERT INTO "EmailSignature" (
			domain, selector, "headerHash", "headerHashV2",
			"dkimSignature", timestamp, "signingAlgorithm", "canonInfo"
		)
		VALUES (
			${domain}, ${selector}, ${headerHash}, ${headerHash},
			${dkimSignatureRaw}, ${timestamp}, ${signingAlgorithm},
			${CANON_INFO_VERSION}
		)
		ON CONFLICT ("headerHashV2", "dkimSignature") DO NOTHING
	`;

    logger.debug('insert_duration', { ms: performance.now() - insertStart });

    if (result === 0) {
      logger.debug('signature_exists', {
        domain,
        selector,
        durationMs: performance.now() - startTime,
      });
      return { signatureStatus: 'duplicate', recoveryFailures: 0 };
    } else {
      logger.info('signature_inserted', { domain, selector });
    }
  } catch (error) {
    logger.debug('insert_error', { durationMs: performance.now() - startTime });
    throw error;
  }

  // The INSERT above is durable independently of optional recovery work.
  // A queue/query failure must not abort archival processing of other signatures.
  let recoveryFailures = 0;
  try {
    // AddResult checks if we got the Public Key via DNS query or it already existed in DB, if not we calculate the GCD
    if (
      (!addResult.added && !addResult.already_in_db) ||
      processResultBadSignatureError
    ) {
      // Fetching future and past Email signature for the given domain and selector
      const sigQueryStart = performance.now();
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
      logger.debug('email_signatures_query', {
        durationMs: performance.now() - sigQueryStart,
      });

      // The combined results will have up to 4 records.
      const dsps = [
        ...new Map(
          [...futureEmailSigs, ...pastEmailSigs].map((row) => [row.id, row])
        ).values(),
      ];
      logger.debug('email_signatures_found', {
        count: dsps.length,
        domain,
        selector,
      });

      if (dsps.length === 0) {
        logger.warn('no_dsps_for_gcd', {
          domain,
          selector,
          durationMs: performance.now() - startTime,
        });
        return { signatureStatus: 'stored', recoveryFailures: 0 };
      }

      // Calculating the signature and encoded message digest for the current email.
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

      // Loop through each found DSP to create a GCD calculation task against the current email.
      for (const dsp of dsps) {
        // Ensure the database record has the required fields.
        if (!dsp.dkimSignature || !dsp.headerHashV2) {
          logger.debug('skip_dsp_missing_fields', { dspId: dsp.id });
          continue;
        }
        // An undated upload's neighbor query can include its own new row.
        // Identical signatures do not supply independent recovery evidence.
        if (dsp.dkimSignature === dkimSignatureRaw) continue;

        // Handle case where the signing algorithms do not match
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

        // Calculating the signature and encoded message digest for the DSP.
        const signature2 = BigInt(
          `0x${Buffer.from(dsp.dkimSignature, 'base64').toString('hex')}`
        ).toString();
        const headerHashBuffer2 = Buffer.from(dsp.headerHashV2, 'hex');
        const encodedMessageDigest2 = encodeRsaPkcs1Digest(
          headerHashBuffer2,
          signingAlgorithm,
          keySizeBytes
        ).toString();
        const taskId = crypto.randomBytes(16).toString('hex').toString();

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

        try {
          await createGcdCalculationTask(payload);
          logger.info('gcd_task_created', { dspId: dsp.id, taskId });
        } catch (error) {
          recoveryFailures++;
          logger.warn('gcd_scheduling_failed_after_storage', {
            domain,
            selector,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      logger.debug('process_email_signature_complete', {
        domain,
        selector,
        durationMs: performance.now() - startTime,
      });
      return { signatureStatus: 'stored', recoveryFailures };
    }
  } catch (error) {
    recoveryFailures++;
    logger.warn('gcd_preparation_failed_after_storage', {
      domain,
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.debug('process_email_signature_complete', {
    domain,
    selector,
    durationMs: performance.now() - startTime,
  });
  return { signatureStatus: 'stored', recoveryFailures };
}
