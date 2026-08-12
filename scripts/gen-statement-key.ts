#!/usr/bin/env tsx
/**
 * Mint a signing key for signed observation statements (REG-736).
 *
 * Usage:
 *   pnpm statement:genkey [--alg EdDSA|ES256] [--kid <kid>]
 *
 * Prints two things:
 *   1. The private JWK: set it as ARCHIVE_STATEMENT_SIGNING_JWK in the
 *      deployment's secret store. It is shown once and never persisted here.
 *   2. The public JWK: append it to src/lib/archive-statement-jwks.json and
 *      commit, BEFORE deploying the secret. The signer refuses to sign under a
 *      kid that is not in the published set, so publishing first is what keeps
 *      a rotation from minting statements nobody can verify.
 *
 * Rotation is append-only. Never remove a key from the published set: consumers
 * archive statements for years and a removed kid retroactively invalidates
 * every statement it signed.
 */

import { exportJWK, generateKeyPair, type JWK } from 'jose';

const SUPPORTED_ALGS = ['EdDSA', 'ES256'] as const;
type SupportedAlg = (typeof SUPPORTED_ALGS)[number];

function parseArgs(): { alg: SupportedAlg; kid: string } {
  const args = process.argv.slice(2);
  let alg: SupportedAlg = 'EdDSA';
  let kid: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--alg' && args[i + 1]) {
      const value = args[++i];
      if (!SUPPORTED_ALGS.includes(value as SupportedAlg)) {
        console.error(`--alg must be one of ${SUPPORTED_ALGS.join(', ')}`);
        process.exit(1);
      }
      alg = value as SupportedAlg;
    } else if (args[i] === '--kid' && args[i + 1]) {
      kid = args[++i];
    }
  }

  // A date-stamped default keeps kids sortable and self-documenting, and makes
  // it obvious at a glance which key an archived statement was signed under.
  if (!kid) {
    const stamp = new Date().toISOString().slice(0, 10);
    kid = `archive-statement-${stamp}`;
  }

  return { alg, kid };
}

async function main() {
  const { alg, kid } = parseArgs();

  const { privateKey, publicKey } = await generateKeyPair(alg, {
    extractable: true,
  });

  const privateJwk: JWK = { ...(await exportJWK(privateKey)), kid, alg };
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg,
    use: 'sig',
  };

  console.log(
    `\nGenerated a ${alg} statement signing key with kid "${kid}".\n`
  );
  console.log('─'.repeat(72));
  console.log('1. PUBLIC half: append to src/lib/archive-statement-jwks.json');
  console.log('   under "keys", then commit and deploy BEFORE the secret:\n');
  console.log(JSON.stringify(publicJwk, null, 2));
  console.log('\n' + '─'.repeat(72));
  console.log('2. PRIVATE half: set as ARCHIVE_STATEMENT_SIGNING_JWK.');
  console.log('   Shown once, not stored. Keep it out of git:\n');
  console.log(JSON.stringify(privateJwk));
  console.log('\n' + '─'.repeat(72));
  console.log(
    '\nVerify afterwards with: pnpm statement:check --domain <d> --selector <s>\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
