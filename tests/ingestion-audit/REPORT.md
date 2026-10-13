# Ingestion fix and historical reproduction audit

## Implemented October 13

The confirmed failure paths are fixed in the application source. Gmail and
mailbox files share per-signature ingestion; optional DNS/recovery failures do
not abort archival storage; partial pages are visible and retryable; listing
errors retain their failure status and cursor. Mailbox submissions compute
header hashes locally and upload only derived signature/hash evidence plus
domain, selector, algorithm and date. No raw headers are transmitted. They
preserve every supported signature across rotations of the same selector. TSV remains
selector discovery and now stops on failed HTTP responses with retry support.

Regression coverage includes simple canonicalization's final header line
ending, no raw-header or body transmission, partial-page retries without duplicate
rows, and contribution rate limiting. There is no per-message signature-count
cap: each evidence request contains one bounded signature. Undated recovery
neighbors are deduplicated by ID before enqueueing. Independent RSA fixtures
verify simple/relaxed SHA1/256/512 hashes with repeated, oversigned and folded
headers; review-before.log and review-debugger.log retain the two reproduced
review defects on unchanged 0e14147 application source. Type checking and the production build passed
locally; production deployment is a separate state.

The remainder is the **October 11 pre-fix audit**, retained with its original
observations and limitations. Statements below about unimplemented proposals
refer to that historical checkpoint.

All three previously claimed Gmail failure paths are reproduced against
unchanged application source. There are 12 passing reproduction/control tests.
The desired-behavior mode has five failures, covering the three primary issues
plus storage/DNS failure variants. This establishes the code's behavior under
controlled failures, not whether those failures occurred in the user's inbox
upload. Production upload completeness remains unverified.
The locked harness also reproduced the same 12/12 observations and five
desired-behavior failures from a clean `git archive` plus `npm ci`.

## 1. One signature's error prevents later signatures from being saved

**Trigger:** one email has two DKIM signatures. Its first signature has a missing
key and a stored neighbor. Cloud Tasks rejects task creation for missing
credentials. The second signature has a known key and is otherwise usable.

**Expected:** both new signatures are saved, with a separately reported recovery
scheduling failure. **Observed:** only the first new signature is saved. The
second is not reached. The API returns HTTP 200, `messagesProcessed: 1`, and
zero signature result entries.

The debugger observed `signatureCount: 2` in `handleMessage`, then the exception
through the real `createGcdCalculationTask` / `processAndStoreEmailSignature`
path with one candidate neighbor and zero queue results. The current signature
is already inserted before the queue failure; it is not rolled back.

Two additional concrete tests confirm the same coupling: an insertion failure
on the first signature prevents the second insert; a domain-selector DB lookup
failure before storage prevents both inserts.

**Root cause:** a per-message error boundary encloses the whole signature loop,
and optional DNS/recovery operations are allowed to abort archival ingestion.

**Proposal:**

- Catch failures per DKIM signature, continue with the remaining signatures,
  and return structured signature outcomes. An actual insertion failure must
  still be reported as unsaved/retryable, never treated as success.
- Catch each queue submission failure after insertion, record
  `evidenceSaved: true` / `recoveryQueued: false`, and continue. Do not undo or
  repeat the successful insert merely to retry computation.
- If DNS discovery/refresh fails, report it and continue to signature/hash
  persistence with a missing-key result. This needs a narrow error boundary
  around the lookup, not a larger rewrite of the persistence routine.

Primary files: `src/app/api/gmail/route.ts` and
`src/lib/storeEmailSignature.ts`. A durable queue retry/backfill policy is a
separate concern; this minimal change must not claim to repair Cloud Tasks
credentials or the existing cross-worker attempt-ledger gap.

## 2. Failed messages are invisible in the completion count

**Trigger:** Gmail lists two messages; one is retrieved and saved, the other
message fetch rejects with a 503-style error.

**Observed:** HTTP 200, `messagesProcessed: 2`, one saved row, one signature
result, and no failure count. Executing the actual client closure produces
processed count 2, no upload error, and an idle/completed state.

The debugger pauses at the failed `messages.get` call and shows its path through
`handleMessage` and `handleRequest`. The per-message catch logs the error but
does not return an outcome into the response. `messagesProcessed` is assigned
the length of the Gmail list.

**Root cause:** the API only counts attempted/listed messages, loses per-message
failure outcomes, and the client cannot distinguish partial ingestion from
successful completion. Counting attempts is not inherently wrong; using that
single count as evidence of success is the defect.

**Proposal:** return additive `messagesAttempted`, `messagesSucceeded`,
`messagesFailed` and signature save/failure counts, derived from explicit
per-message/per-signature outcomes. Keep a legacy attempted-count field if
needed for compatibility. Distinguish no-DKIM and exact-duplicate cases from
actual failures. Have the client show incomplete ingestion and retain failed
message IDs or a page cursor for retry. Idempotent signature inserts allow a
whole page to be retried without duplicating evidence.

Primary files: the Gmail route and `EmailUploader.tsx`. Avoid returning raw
mailbox contents or credentials in error details. This can be an additive API
change plus a small client status/error update; a new ingestion service is not
required.

## 3. Gmail listing failure looks like normal end-of-mailbox

**Trigger:** a scan with `pageToken: resume-cursor` gets a 429-style rejection
from `gmail.users.messages.list`.

**Observed:** the route catches the error and manufactures an empty response:
HTTP 200, zero messages, and `nextPageToken: null`. The actual client closure
clears its cursor, stops processing and shows no error. Debugger inspection
confirms the input cursor is present and `isFirstPage` is false at the rejection.

**Root cause:** a provider failure is converted to the same response contract
as successful pagination exhaustion.

**Proposal:** return a non-2xx response instead of an empty page. Preserve
429/authentication distinctions when they are available; return 503 for other
transient provider failures. Keep the current cursor and use the existing
client error branch. A control test already proves that a 503 response shows
an error and retains `resume-cursor`, so a client rewrite is unnecessary for
this issue. A genuine successful empty final page must still finish normally.

## Additional file-upload findings

These are separate from the three Gmail defects, and matter if the inbox was
uploaded as an `.mbox`/`.eml` file rather than through Gmail.

The real mailbox parser and client submit closure turn two signed messages
with the same domain/selector into one `/api/dsp` POST containing only
`domain` and `selector`. The real DSP route performs DNS discovery and stores
zero `EmailSignature` rows. Neither hashes nor signatures are transmitted.
My previous general statement that inbox uploads preserve that evidence needs
this qualification: it applies to the Gmail ingestion path, not the file path.

If file uploads are intended to contribute historical verification evidence,
route mailbox messages through the same evidence-ingestion logic, preserving
canonicalization bytes and deduplicating by signature+hash rather than by
domain/selector. Keep TSV uploads explicitly as selector discovery, since TSV
rows do not contain signatures or signed headers. This is a separate feature
gap, not something the three small Gmail changes can repair.

Another test supplies HTTP 429 to the real file-submit closure. It still adds
an ordinary result row and increments progress. A surgical fix is to check
`response.ok` before accepting the payload, expose per-pair failures and retain
the failed index for a rate-limited retry. The test confirms this code path;
the user's actual upload mode and production response history are unknown.

## Positive controls and limits

- Missing DNS keys do not by themselves suppress signature/hash insertion.
- The saved header digest matches a real RSA signature's PKCS#1 digest block.
- Exact repeat scans leave one saved evidence row intact.
- Two signatures with known keys are both persisted.
- A real empty final page finishes the scan normally.
- A non-2xx listing response already displays an error and retains the cursor.

No application source, hosting settings or production data was changed.
Proposals have not been implemented, tested after a patch, deployed, or run in
CI. The harness does not prove real Google API error frequency, actual
PostgreSQL durability, framework rendering, or the completeness of a specific
production upload. Once fixes are implemented, the five desired invariants
must pass, with these adjacent controls retained.
