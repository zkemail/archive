# Inbox ingestion regression tests

These tests execute the actual ingestion implementation with controlled Gmail,
DNS, Cloud Tasks and database boundaries. They cover missing-key storage,
duplicate scans, independent signatures, visible partial-page failures,
pagination retries, header-only mailbox evidence, rate limits and byte-preserving
canonicalization.

Run without production credentials or generated Prisma files:

```sh
cd tests/ingestion-audit
npm ci --ignore-scripts
npm test
```

The suite runs in the ingestion CI job on non-draft PRs and default-branch pushes.
The CI workflow includes ready_for_review, and skips draft PR updates.

The original audit and debugger observations remain in REPORT.md and
reproduction.log/debugger.log. Five desired-behavior checks failed on the
pre-fix implementation (pre-fix.log). post-fix.log records the fixed suite.
Historical logs are evidence of earlier revisions, not current expectations.

The harness compiles complete server modules and selects actual client closures
by TypeScript AST without rewriting their bodies. It mocks external provider,
auth, Next response/headers, React setter and timer boundaries. RSA signatures
are synthetic and valid; controls compare their decrypted PKCS#1 digest blocks
with the saved header hashes. It does not prove production upload completeness,
actual PostgreSQL durability, or browser rendering.

Dependencies are pinned and locked. No raw real emails or credentials are used.
