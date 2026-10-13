import { logger } from './logger';
import {
  processAndStoreEmailSignature,
  type ProcessResult,
} from './storeEmailSignature';
import {
  type DomainAndSelector,
  getDkimSigsArray,
  parseDkimTagListV2,
  parseEmailHeader,
} from './utils';
import { addDomainSelectorPair, type AddResult } from './utilsServer';

export type SignatureResult = {
  addResult: AddResult;
  processResult: ProcessResult;
  domainSelectorPair: DomainAndSelector;
  mailTimestamp?: string;
};

export async function ingestEmail(
  rawEmail: string,
  timestamp: Date | null,
  verifySignature?: (domain: string) => Promise<unknown>
) {
  const addDspResults: SignatureResult[] = [];
  let signaturesFailed = 0;
  const emailHeaders = parseEmailHeader(rawEmail);
  for (const dkimSig of getDkimSigsArray(rawEmail)) {
    const tags = parseDkimTagListV2(dkimSig);
    const domain = tags.d;
    const selector = tags.s;
    if (!domain || !selector) continue;
    try {
      let badSignature = false;
      if (verifySignature) {
        try {
          await verifySignature(domain);
        } catch (error) {
          logger.warn('dkim_verify_failed', {
            domain,
            error: error instanceof Error ? error.message : String(error),
          });
          badSignature =
            error instanceof Error && error.message.includes('bad signature');
        }
      }
      let addResult: AddResult = { added: false, already_in_db: false };
      if (!badSignature) {
        try {
          addResult = await addDomainSelectorPair(domain, selector, 'api');
        } catch (error) {
          logger.warn('dns_discovery_failed_before_storage', {
            domain,
            selector,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const processResult = await processAndStoreEmailSignature(
        emailHeaders,
        dkimSig,
        tags,
        timestamp,
        addResult,
        badSignature
      );
      addDspResults.push({
        addResult,
        processResult,
        domainSelectorPair: { domain, selector },
        mailTimestamp: timestamp?.toISOString(),
      });
    } catch (error) {
      signaturesFailed++;
      logger.warn('email_signature_ingestion_failed', {
        domain,
        selector,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    addDspResults,
    signaturesFailed,
    signaturesStored: addDspResults.filter(
      (r) => r.processResult.signatureStatus === 'stored'
    ).length,
    signaturesDuplicate: addDspResults.filter(
      (r) => r.processResult.signatureStatus === 'duplicate'
    ).length,
    signaturesSkipped: addDspResults.filter(
      (r) => r.processResult.signatureStatus === 'skipped'
    ).length,
    recoveryFailures: addDspResults.reduce(
      (sum, r) => sum + r.processResult.recoveryFailures,
      0
    ),
  };
}
