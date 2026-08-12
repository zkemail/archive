import forge from 'node-forge';

import { Prisma } from '@/generated/prisma/client';
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
  // Present in the payload but deliberately unused. The observation window is
  // taken from the stored EmailSignature rows instead, because these are
  // caller-supplied and this endpoint is unauthenticated (REG-737).
  timestamp1?: Date | null;
  timestamp2?: Date | null;
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
  // DKIM predates neither of these. A value outside the range is a parse
  // artefact or a crafted header, not a real signing date.
  const FLOOR = Date.UTC(1990, 0, 1);
  const CEILING = Date.now() + 24 * 60 * 60 * 1000;

  const parse = (value: Date | string | null): Date | null => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (Number.isNaN(time) || time < FLOOR || time > CEILING) return null;
    return date;
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

    // REG-737: resolve the evidence BEFORE writing anything.
    //
    // This endpoint is unauthenticated, and its only other gate is
    // verifyRsaPublicKey, which checks a signature against a modulus that also
    // comes from the request body: an attacker signs their own digests with
    // their own key and it passes. The write used to happen first and this
    // lookup second, with the failure throwing into a catch that swallowed it
    // after the record had already committed. So a request naming any domain
    // could land a DkimRecord for a key nobody controls.
    //
    // Requiring both signatures to already exist in our own table means a
    // recovery can only ever attach to email we stored, and no write happens
    // for one we did not. This does not make the endpoint authenticated: an
    // attacker who can get crafted EmailSignature rows in through the upload
    // path is still in scope until the callback itself is authenticated
    // (REG-737 part 2, a shared secret echoed by the Cloud Function).
    // Matched on (headerHashV2, dkimSignature), which is the unique constraint
    // on EmailSignature, rather than on (domain, selector, headerHash).
    //
    // Two reasons. The task-creation path sends `headerHashV2` values in the
    // metadata for both halves of the pair (storeEmailSignature writes the same
    // digest into both columns on insert and sends `dsp.headerHashV2`), so this
    // is the column the values actually correspond to. And it goes straight to
    // the unique index instead of the (domain, selector, timestamp) one.
    //
    // Deliberately not filtering on domain/selector here: the callback
    // lowercases them, but 51 stored rows have a non-lowercase domain and 237 a
    // non-lowercase selector, and Prisma's default equality is case-sensitive,
    // so including them silently matched nothing for those recoveries. They are
    // re-checked case-insensitively below, where a mismatch is a real signal
    // rather than an accident of casing.
    const [emailSignatureA, emailSignatureB] = await Promise.all([
      prisma.emailSignature.findFirst({
        where: {
          headerHashV2: data.metadata.headerHash1,
          dkimSignature: data.metadata.dkimSignature1,
        },
      }),
      prisma.emailSignature.findFirst({
        where: {
          headerHashV2: data.metadata.headerHash2,
          dkimSignature: data.metadata.dkimSignature2,
        },
      }),
    ]);

    if (!emailSignatureA || !emailSignatureB) {
      // Not an exception: a callback naming signatures we never stored is
      // exactly the shape a forged one takes. Refuse it and write nothing.
      logger.warn('gcd_callback_unknown_signatures', {
        taskId: data.taskId,
        domain,
        selector,
      });
      return;
    }

    // The signatures exist, but they must also belong to the pair the caller
    // claims. Without this a caller could point real signatures from one domain
    // at a record for another. Compared case-insensitively because stored
    // casing is inconsistent; the callback's own values are already lowercased.
    const belongsToPair = (sig: { domain: string; selector: string }) =>
      sig.domain.toLowerCase() === domain &&
      sig.selector.toLowerCase() === selector;

    if (!belongsToPair(emailSignatureA) || !belongsToPair(emailSignatureB)) {
      logger.warn('gcd_callback_signature_pair_mismatch', {
        taskId: data.taskId,
        claimed: `${domain}/${selector}`,
        actualA: `${emailSignatureA.domain}/${emailSignatureA.selector}`,
        actualB: `${emailSignatureB.domain}/${emailSignatureB.selector}`,
      });
      return;
    }

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

    const existingRecord = await prisma.dkimRecord.findFirst({
      where: {
        domainSelectorPairId: domainSelectorPair.id,
        keyData: data.publicKey,
      },
    });

    // Only the id is needed downstream. Deliberately not carrying the whole row
    // past this point: the update below happens in the database, so any field
    // read off the pre-update snapshot afterwards would be stale.
    let dkimRecordId: number;

    // The two source emails' dates bound what this recovery actually proves:
    // the key signed mail between them. Take them from the rows we just
    // resolved, never from the request body. The caller supplies timestamps
    // too, but trusting those let anyone holding two genuinely signed messages
    // from a domain replay them with an arbitrary window and stretch the
    // record's dates without bound.
    //
    // Either stored timestamp can still be null when the source email carried
    // no parseable Date header. Previously `new Date(null!)` silently became
    // the Unix epoch and dragged firstSeenAt back to 1970, so guard explicitly
    // and skip the time attribution rather than record a false window.
    const gcdBounds = gcdObservationWindow(
      emailSignatureA.timestamp,
      emailSignatureB.timestamp
    );

    if (!gcdBounds) {
      logger.warn('gcd_missing_email_timestamps', {
        taskId: data.taskId,
        domain,
        selector,
      });
    }

    if (existingRecord) {
      dkimRecordId = existingRecord.id;

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
        // Widen in the database rather than from the row we read a moment ago.
        // Two callbacks completing at once would otherwise both compute their
        // bounds from the same pre-update snapshot, and the second write would
        // discard the first one's widening. LEAST/GREATEST make the update
        // monotonic regardless of interleaving. Prisma has no atomic min/max
        // for DateTime, hence the raw statement.
        await prisma.$executeRaw`
          UPDATE "DkimRecord"
          SET "firstSeenAt"    = LEAST("firstSeenAt", ${gcdBounds.first}::timestamp),
              "lastSeenAt"     = GREATEST(COALESCE("lastSeenAt", "firstSeenAt"), ${gcdBounds.last}::timestamp),
              "gcdFirstSeenAt" = LEAST(COALESCE("gcdFirstSeenAt", ${gcdBounds.first}::timestamp), ${gcdBounds.first}::timestamp),
              "gcdLastSeenAt"  = GREATEST(COALESCE("gcdLastSeenAt", ${gcdBounds.last}::timestamp), ${gcdBounds.last}::timestamp)
          WHERE id = ${existingRecord.id}
        `;
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
      const created = await prisma.dkimRecord.create({
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
      dkimRecordId = created.id;
      logger.info('dkim_record_created', {
        domain: data.metadata.domain,
        selector: data.metadata.selector,
      });
    }

    // Link the pair to the record. A retried callback hits the composite
    // primary key, which is the intended idempotency: the recovery is already
    // recorded, so treat the conflict as success rather than an error the
    // Cloud Function should retry again.
    try {
      await prisma.emailPairGcdResult.create({
        data: {
          emailSignatureA_id: emailSignatureA.id,
          emailSignatureB_id: emailSignatureB.id,
          foundGcd: true,
          dkimRecordId,
          timestamp: data.completedAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        logger.info('gcd_result_already_recorded', { taskId: data.taskId });
      } else {
        throw error;
      }
    }

    // Only now is every write done, so a stale cache entry cannot outlive a
    // committed change and be served as the current window.
    clearRecordsCache(domain, selector);

    logger.info('gcd_result_stored', { taskId: data.taskId });
  } catch (error) {
    logger.error('gcd_store_error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
