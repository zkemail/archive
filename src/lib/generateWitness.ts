// Remove all the related to witness co.
import { WitnessClient } from '@witnessco/client';

import type { DkimRecord, DomainSelectorPair } from '@/generated/prisma/client';

import { prisma, recordToString } from './db';
import {
  getCanonicalJWKRecordString,
  getCanonicalRecordString,
  jwkSet,
} from './utils';

interface BackoffOptions {
  initialDelay: number;
  maxDelay: number;
  maxRetries: number;
  backoffFactor: number;
}

const defaultOpts: BackoffOptions = {
  initialDelay: 1000,
  maxDelay: 30000,
  maxRetries: 5,
  backoffFactor: 2,
};

export async function generateWitness(
  dsp: DomainSelectorPair,
  dkimRecord: DkimRecord
) {
  try {
    const canonicalRecordString = getCanonicalRecordString(
      dsp,
      dkimRecord.value
    );
    const witness = new WitnessClient(process.env.WITNESS_API_KEY);
    const leafHash = witness.hash(canonicalRecordString);
    let timestamp;
    let attempts = 0;
    let currentDelay = defaultOpts.initialDelay;
    while (attempts < defaultOpts.maxRetries) {
      try {
        attempts++;
        timestamp = await witness.postLeafAndGetTimestamp(leafHash);
        break;
      } catch (error: any) {
        console.warn(
          `[Witness] postLeafAndGetTimestamp attempt ${attempts} failed for ${recordToString(
            dkimRecord
          )}: ${error?.message || error}`
        );
        if (attempts === defaultOpts.maxRetries) {
          console.warn(
            `[Witness] Max retries reached for ${recordToString(dkimRecord)} - witness service unavailable`
          );
          return;
        }
        currentDelay = Math.min(
          currentDelay * defaultOpts.backoffFactor,
          defaultOpts.maxDelay
        );
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
      }
    }
    console.log(`[Witness] leaf ${leafHash} timestamped at ${timestamp}`);
    const proof = await witness.getProofForLeafHash(leafHash);
    const verified = await witness.verifyProofChain(proof);
    if (!verified) {
      console.warn('[Witness] proof chain verification failed');
      return;
    }
    console.log(
      `[Witness] proof verified, setting provenanceVerified for ${recordToString(
        dkimRecord
      )}`
    );
    await prisma.dkimRecord.update({
      where: {
        id: dkimRecord.id,
      },
      data: {
        provenanceVerified: true,
      },
    });
  } catch (error: any) {
    console.warn(
      `[Witness] Service unavailable for ${recordToString(dkimRecord)}: ${error?.message || error}`
    );
  }
}

export async function generateJWKWitness(JwkSet: jwkSet) {
  try {
    const canonicalRecordString = getCanonicalJWKRecordString(JwkSet);
    const witness = new WitnessClient(process.env.WITNESS_API_KEY);
    const leafHash = witness.hash(canonicalRecordString);
    let timestamp;
    try {
      timestamp = await witness.postLeafAndGetTimestamp(leafHash);
    } catch (error: any) {
      console.warn(
        `[Witness] postLeafAndGetTimestamp failed for JWKSet ${JwkSet.id}: ${error?.message || error}`
      );
      return;
    }
    console.log(`[Witness] leaf ${leafHash} timestamped at ${timestamp}`);
    const proof = await witness.getProofForLeafHash(leafHash);
    const verified = await witness.verifyProofChain(proof);
    if (!verified) {
      console.warn('[Witness] JWK proof chain verification failed');
      return;
    }
    console.log(
      `[Witness] JWK proof verified, setting provenanceVerified for ${JwkSet.id}`
    );
    await prisma.jsonWebKeySets.update({
      where: {
        id: JwkSet.id,
      },
      data: {
        provenanceVerified: true,
      },
    });
  } catch (error: any) {
    console.warn(
      `[Witness] Service unavailable for JWKSet ${JwkSet.id}: ${error?.message || error}`
    );
  }
}
