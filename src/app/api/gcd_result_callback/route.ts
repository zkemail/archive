import forge from 'node-forge';

import { clearRecordsCache, prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { encodeRsaPkcs1Digest, pubKeyLength } from '@/lib/utilsServer';

interface GcdCallbackMetadata {
  domain: string;
  selector: string;
  headerHash1: string;
  headerHash2: string;
  dkimSignature1: string;
  dkimSignature2: string;
  signingAlgorithm: string;
  timestamp1: Date | null;
  timestamp2: Date | null;
}

function verifyRsaPublicKey(
  publicKeyHex: string,
  signatureBase64: string,
  messageDigestHex: string,
  signingAlgorithm: string,
  exponentStr: string = '65537'
): boolean {
  try {
    const keySizeBytes = pubKeyLength(signatureBase64);

    if (publicKeyHex.length !== keySizeBytes * 2) {
      logger.warn('public_key_length_mismatch', {
        expected: keySizeBytes * 2,
        got: publicKeyHex.length,
      });
      return false;
    }
    // Encode the message digest as per PKCS#1 for the given algorithm
    const encodedDigest = encodeRsaPkcs1Digest(
      Buffer.from(messageDigestHex, 'hex'),
      signingAlgorithm,
      keySizeBytes
    ).toString();

    // Convert signature from base64 to BigInt string
    const signatureBigIntStr = BigInt(
      `0x${Buffer.from(signatureBase64, 'base64').toString('hex')}`
    ).toString();

    // Convert all values to forge.jsbn.BigInteger
    const modulus = new forge.jsbn.BigInteger(publicKeyHex, 16);
    const signature = new forge.jsbn.BigInteger(signatureBigIntStr, 10);
    const encodedDigestBigInt = new forge.jsbn.BigInteger(encodedDigest, 10);
    const exponent = new forge.jsbn.BigInteger(exponentStr, 10);

    // RSA verification: signature^exponent mod modulus
    const verified = signature.modPow(exponent, modulus);

    // Compare the result with the encoded digest
    return verified.compareTo(encodedDigestBigInt) === 0;
  } catch (error) {
    logger.error('rsa_verification_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { success, result, error, taskId, metadata } = body as {
      success: boolean;
      result?: string;
      error?: string;
      taskId?: string;
      metadata?: GcdCallbackMetadata;
    };

    if (!taskId) {
      logger.warn('gcd_callback_missing_taskid');
      return Response.json({ error: 'Missing taskId' }, { status: 400 });
    }

    if (!metadata) {
      logger.warn('gcd_callback_missing_metadata', { taskId });
      return Response.json({ error: 'Missing metadata' }, { status: 400 });
    }

    if (success) {
      logger.info('gcd_task_success', { taskId });

      const publicKeyBigInt = BigInt(result!);
      const publicKeyHex = publicKeyBigInt.toString(16);
      const publicKeyBigIntjsbn = new forge.jsbn.BigInteger(publicKeyHex, 16);
      const e = new forge.jsbn.BigInteger('010001', 16);
      const publicKeyRaw = forge.pki.setRsaPublicKey(publicKeyBigIntjsbn, e);

      const publicKeyDer = forge.asn1
        .toDer(forge.pki.publicKeyToAsn1(publicKeyRaw))
        .getBytes();
      const publicKey = forge.util.encode64(publicKeyDer);

      logger.debug('gcd_result', {
        selector: metadata.selector,
        domain: metadata.domain,
      });

      const isHeaderHash1SignatureValid = verifyRsaPublicKey(
        publicKeyHex,
        metadata.dkimSignature1,
        metadata.headerHash1,
        metadata.signingAlgorithm
      );
      const isHeaderHash2SignatureValid = verifyRsaPublicKey(
        publicKeyHex,
        metadata.dkimSignature2,
        metadata.headerHash2,
        metadata.signingAlgorithm
      );

      if (!isHeaderHash1SignatureValid || !isHeaderHash2SignatureValid) {
        return Response.json(
          {
            error: 'Public Key is Not valid',
          },
          {
            status: 400,
          }
        );
      }

      await storeCalculationResult({
        taskId,
        result,
        completedAt: new Date(),
        metadata,
        publicKey,
      });
    } else {
      logger.error('gcd_task_failed', { taskId, error });
    }

    return Response.json(
      {
        message: 'Callback processed successfully',
        taskId,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('gcd_callback_error', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Return 500 so the Cloud Function can retry if needed
    return Response.json(
      { error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}

/** Earliest of the two, treating an absent stored bound as "no bound yet". */
function minDate(existing: Date | null, incoming: Date): Date {
  return existing && existing.getTime() < incoming.getTime()
    ? existing
    : incoming;
}

/** Latest of the two, treating an absent stored bound as "no bound yet". */
function maxDate(existing: Date | null, incoming: Date): Date {
  return existing && existing.getTime() > incoming.getTime()
    ? existing
    : incoming;
}

/**
 * The window a GCD recovery is entitled to claim: the span between the two
 * source emails' dates. Returns null unless both are present and parseable, since
 * the callback metadata types them as nullable and a missing Date header is a
 * real case, so a bad value must yield "unknown", never a bogus instant.
 * The pair is ordered defensively; nothing guarantees timestamp1 <= timestamp2.
 */
function gcdObservationWindow(
  timestamp1: Date | string | null,
  timestamp2: Date | string | null
): { first: Date; last: Date } | null {
  const parse = (value: Date | string | null): Date | null => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const a = parse(timestamp1);
  const b = parse(timestamp2);
  if (!a || !b) return null;

  return a.getTime() <= b.getTime()
    ? { first: a, last: b }
    : { first: b, last: a };
}

async function storeCalculationResult(data: {
  taskId: string;
  result?: string;
  error?: string;
  completedAt: Date;
  metadata: GcdCallbackMetadata;
  publicKey: string;
}) {
  try {
    // Normalize domain and selector to lowercase
    const domain = data.metadata.domain.toLowerCase();
    const selector = data.metadata.selector.toLowerCase();

    const domainSelectorPair = await prisma.domainSelectorPair.upsert({
      where: {
        id: await prisma.domainSelectorPair
          .findFirst({
            where: {
              domain: domain,
              selector: selector,
            },
          })
          .then((dsp) => dsp?.id ?? -1),
      },
      create: {
        domain: domain,
        selector: selector,
        sourceIdentifier: 'api_auto',
        lastRecordUpdate: data.completedAt,
      },
      update: {
        lastRecordUpdate: data.completedAt,
      },
    });

    let dkimRecord = await prisma.dkimRecord.findFirst({
      where: {
        domainSelectorPairId: domainSelectorPair.id,
        keyData: data.publicKey,
      },
    });

    // The two source emails' dates bound what this recovery actually proves:
    // the key signed mail between them. They are the only timestamps a GCD
    // recovery may claim. Either can be absent when the source email carried no
    // parseable Date header, and previously `new Date(null!)` silently became the
    // Unix epoch and dragged firstSeenAt back to 1970, so guard explicitly and
    // skip the time attribution rather than record a false window.
    const gcdBounds = gcdObservationWindow(
      data.metadata.timestamp1,
      data.metadata.timestamp2
    );

    if (!gcdBounds) {
      logger.warn('gcd_missing_email_timestamps', {
        taskId: data.taskId,
        domain,
        selector,
      });
    }

    if (dkimRecord) {
      // REG-735: a GCD recovery must never move a live-DNS record's window.
      // This lookup matches on keyData, which is the same normalized SPKI for a
      // key we scraped from DNS and one we recovered from signatures, so this
      // branch routinely lands on a DNS-sourced record. Widen the GCD channel
      // and the union window only; dnsFirstSeenAt / dnsLastSeenAt are left
      // untouched so a live-DNS observation stays a live-DNS observation.
      //
      // With no usable bounds there is nothing to widen, so skip the write
      // rather than issue an empty update and log a change that did not happen.
      if (gcdBounds) {
        dkimRecord = await prisma.dkimRecord.update({
          where: { id: dkimRecord.id },
          data: {
            firstSeenAt: minDate(dkimRecord.firstSeenAt, gcdBounds.first),
            lastSeenAt: maxDate(dkimRecord.lastSeenAt, gcdBounds.last),
            gcdFirstSeenAt: minDate(dkimRecord.gcdFirstSeenAt, gcdBounds.first),
            gcdLastSeenAt: maxDate(dkimRecord.gcdLastSeenAt, gcdBounds.last),
          },
        });
        logger.info('dkim_record_updated', {
          domain: data.metadata.domain,
          selector: data.metadata.selector,
        });
      }
    } else {
      // When the email dates are missing we cannot date the recovery at all.
      // Fall back to the completion time for the union window (so the record
      // still appears in the archive) but leave the GCD channel empty, so
      // nothing downstream can mistake "when we computed it" for "when it
      // signed mail".
      dkimRecord = await prisma.dkimRecord.create({
        data: {
          domainSelectorPairId: domainSelectorPair.id,
          firstSeenAt: gcdBounds?.first ?? data.completedAt,
          lastSeenAt: gcdBounds?.last ?? data.completedAt,
          value: `p=${data.publicKey}`,
          keyType: 'RSA',
          keyData: data.publicKey,
          source: 'public_key_gcd_cloud_function',
          gcdFirstSeenAt: gcdBounds?.first,
          gcdLastSeenAt: gcdBounds?.last,
        },
      });
      logger.info('dkim_record_created', {
        domain: data.metadata.domain,
        selector: data.metadata.selector,
      });
    }

    // Invalidate as soon as the record write has committed, not at the end of
    // the function. Two statements below can throw after this point (the
    // "Could not find email signatures" guard, and the composite-PK violation
    // a retried callback hits), and the outer catch swallows both. Clearing
    // late meant a committed change could leave a stale cache entry that the
    // statement endpoint would then sign.
    clearRecordsCache(domain, selector);

    // Find the email signature entries
    const emailSignatureA = await prisma.emailSignature.findFirst({
      where: {
        domain: domain,
        selector: selector,
        headerHash: data.metadata.headerHash1,
        dkimSignature: data.metadata.dkimSignature1,
      },
    });

    const emailSignatureB = await prisma.emailSignature.findFirst({
      where: {
        domain: domain,
        selector: selector,
        headerHash: data.metadata.headerHash2,
        dkimSignature: data.metadata.dkimSignature2,
      },
    });

    if (!emailSignatureA || !emailSignatureB) {
      throw new Error('Could not find email signatures');
    }

    // Create the GCD result entry linking the signatures
    await prisma.emailPairGcdResult.create({
      data: {
        emailSignatureA_id: emailSignatureA.id,
        emailSignatureB_id: emailSignatureB.id,
        foundGcd: true,
        dkimRecordId: dkimRecord.id,
        timestamp: data.completedAt,
      },
    });

    logger.info('gcd_result_stored', { taskId: data.taskId });
  } catch (error) {
    logger.error('gcd_store_error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
