# Inbox ingestion reproduction audit

These tests reproduce existing behavior; they do not patch the application.

```sh
cd tests/ingestion-audit
npm ci --ignore-scripts
npm test
npm run debug
npm run invariants
```

`npm test` asserts the observed pre-fix behavior and the positive controls.
`npm run invariants` asserts the desired behavior for the five failing
scenarios. On the audited source, it deliberately fails five tests. A passing
reproduction suite is **not** evidence that the application has been fixed.

The harness compiles and executes the actual Gmail route, signature storage,
canonicalization, DNS-discovery and GCD task-creation modules. It also executes
the actual client fetch and file-submit closures selected by TypeScript AST,
without rewriting their bodies. It mocks Gmail/DNS/Cloud Tasks SDK boundaries,
database calls, auth, Next response/headers boundaries, React setters and timers.
It does not render React or run a real Gmail/Render/PostgreSQL session.

All messages are synthetic. RSA signatures are generated with ephemeral keys;
positive controls decrypt each stored signature's PKCS#1 block with its public
key and check that its digest matches the stored hash. No credentials or real
mailbox contents are needed. Dependencies are pinned and locked independently
of production dependencies.

Node used for the audit: 26.11.1. Audited integration revision:
`172218814d5ed608b41c35d6380907f11ab37a68`. The ingestion files are byte-identical
to production/main revision `aeff0fa5002d0e3b5f51d3edb54ec8c15cc575a0`.
Each run prints SHA-256 hashes of the relevant source files.

See [findings and proposals](REPORT.md), [reproduction output](reproduction.log),
[debugger observations](debugger.log), and [failing desired invariants](invariants-before.log).
The same results were reproduced from a clean `git archive` with `npm ci`:
[clean reproduction](clean-reproduction.log) and
[clean failing invariants](clean-invariants-before.log).

No CI workflow has been changed because this request is to verify bugs and
propose fixes. When implementing the fixes, run the fixed-expectations mode in
the repository's non-draft PR CI; preserve the successful-storage/duplicate/
pagination controls. The current reproduction assertions will need to be
converted to the corrected expectations rather than left as bug expectations.
