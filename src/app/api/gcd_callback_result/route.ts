import forge from 'node-forge';

import { prisma } from '@/lib/db';
import { generateWitness } from '@/lib/generateWitness';
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

    if (dkimRecord) {
      const newFirstSeenAt = new Date(
        Math.min(
          new Date(dkimRecord.firstSeenAt!).getTime(),
          new Date(data.metadata.timestamp1!).getTime()
        )
      );
      const newLastSeenAt = new Date(
        Math.max(
          new Date(dkimRecord.lastSeenAt!).getTime(),
          new Date(data.metadata.timestamp2!).getTime()
        )
      );

      dkimRecord = await prisma.dkimRecord.update({
        where: { id: dkimRecord.id },
        data: {
          firstSeenAt: newFirstSeenAt,
          lastSeenAt: newLastSeenAt,
        },
      });
      logger.info('dkim_record_updated', {
        domain: data.metadata.domain,
        selector: data.metadata.selector,
      });
    } else {
      dkimRecord = await prisma.dkimRecord.create({
        data: {
          domainSelectorPairId: domainSelectorPair.id,
          firstSeenAt: data.metadata.timestamp1!,
          lastSeenAt: data.metadata.timestamp2!,
          provenanceVerified: false,
          value: `p=${data.publicKey}`,
          keyType: 'RSA',
          keyData: data.publicKey,
          source: 'public_key_gcd_cloud_function',
        },
      });
      logger.info('dkim_record_created', {
        domain: data.metadata.domain,
        selector: data.metadata.selector,
      });
    }

    generateWitness(domainSelectorPair, dkimRecord);

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
