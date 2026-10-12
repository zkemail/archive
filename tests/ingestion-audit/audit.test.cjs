const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const inspector = require('node:inspector');
const ts = require('typescript');
const { z } = require('zod');

const root = path.resolve(__dirname, '../..');
const expectFixed = process.env.AUDIT_EXPECT_FIXED === '1';
const debug = process.env.AUDIT_DEBUG === '1';
const sourceFiles = [
  'src/app/api/gmail/route.ts',
  'src/lib/storeEmailSignature.ts',
  'src/lib/utils.ts',
  'src/lib/utilsServer.ts',
  'src/app/contribute/EmailUploader.tsx',
];
console.log('SOURCE_HASHES', JSON.stringify(Object.fromEntries(sourceFiles.map((f) => [
  f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'),
]))));

// Compile full real modules. Only network/framework/DB boundaries are replaced.
function compile(source, file) {
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
}

function createWorld(options = {}) {
  const rows = [];
  const logs = [];
  const queueCalls = [];
  const listCalls = [];
  const messages = new Map();
  const cache = new Map();
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
    level, (event, properties) => logs.push({ level, event, ...properties }),
  ]));
  const prisma = {
    domainSelectorPair: {
      findFirst: async ({ where }) => {
        if (options.dnsDatabaseFailureDomain === where.domain) throw new Error('domain-selector database unavailable');
        return options.knownDomains?.includes(where.domain)
          ? { id: 1, ...where, lastRecordUpdate: new Date() }
          : null;
      },
    },
    $executeRaw: async (strings, ...values) => {
      assert.match(strings.join('?'), /INSERT INTO "EmailSignature"/);
      const [domain, selector, headerHash, headerHashV2, dkimSignature, timestamp,
        signingAlgorithm, canonInfo] = values;
      if (options.insertFailureDomain === domain) throw new Error('database insert unavailable');
      if (rows.some((r) => r.headerHashV2 === headerHashV2 && r.dkimSignature === dkimSignature)) return 0;
      rows.push({ id: rows.length + 1, domain, selector, headerHash, headerHashV2,
        dkimSignature, timestamp, signingAlgorithm, canonInfo });
      return 1;
    },
    emailSignature: {
      findMany: async ({ where, take, orderBy }) => rows.filter((r) => {
        if (r.domain.toLowerCase() !== where.domain.equals.toLowerCase()) return false;
        if (r.selector.toLowerCase() !== where.selector.equals.toLowerCase()) return false;
        if (where.timestamp.gt && !(r.timestamp > where.timestamp.gt)) return false;
        if (where.timestamp.lt && !(r.timestamp < where.timestamp.lt)) return false;
        return true;
      }).sort((a, b) => (orderBy.timestamp === 'asc' ? 1 : -1) * (a.timestamp - b.timestamp)).slice(0, take),
    },
  };
  const provider = { users: {
    getProfile: async () => ({ data: { messagesTotal: messages.size } }),
    messages: {
      list: async (params) => {
        listCalls.push(params);
        if (options.listFailure) throw new Error('Gmail API: quota exceeded (429)');
        return { data: {
          messages: [...messages.keys()].map((id) => ({ id })),
          nextPageToken: options.nextPageToken ?? null,
        } };
      },
      get: async ({ id }) => {
        if (options.fetchFailureId === id) throw new Error('Gmail API: message fetch unavailable (503)');
        return { data: messages.get(id) };
      },
    },
  } };
  const NextResponse = { json: (body, init) => Response.json(body, init) };
  function load(relative) {
    const file = path.join(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    function requireBoundary(name) {
      if (name === 'zod') return { z };
      if (name === 'next/server') return { NextResponse };
      if (name === 'next/headers') return { headers: async () => new Headers({ host: 'archive.zk.email' }) };
      if (name === '@/auth') return { auth: async () => ({
        user: { email: 'fixture@example.test' }, accessToken: 'synthetic-fixture-token', hasGmailScope: true,
      }) };
      if (name === '@/lib/client-identity') return {
        CONTRIBUTE_BUDGET: {}, resolveClientIdentity: async () => ({ type: 'fixture', identifier: 'synthetic' }),
        checkClientRateLimit: async () => options.dspRateLimit
          ? { allowed: false, limit: 10, windowSeconds: 60, retryAfterSeconds: 60 }
          : { allowed: true },
      };
      if (name === 'googleapis') return { google: {
        auth: { OAuth2: class { setCredentials() {} } }, gmail: () => provider,
      } };
      if (name === '@zk-email/helpers/dist/dkim') return {
        verifyDKIMSignature: async () => { throw new Error('DNS: public key not found'); },
      };
      if (name === '@/generated/prisma/client') return { Prisma: { QueryMode: { insensitive: 'insensitive' } } };
      if (name.endsWith('/logger') || name === './logger') return { logger };
      if (name === './db' || name === '@/lib/db') return { prisma };
      if (name === '@google-cloud/tasks') return {
        CloudTasksClient: class {
          queuePath() { return 'projects/fixture/locations/us-central1/queues/fixture'; }
          async createTask({ task }) {
            queueCalls.push(JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString()));
            if (options.queueFailure) throw new Error('Could not load the default credentials');
            return [{ name: 'fixture-task' }];
          }
        },
      };
      if (name === 'clsx') return { clsx: () => { throw new Error('unused UI utility'); } };
      if (name === 'tailwind-merge') return { twMerge: () => { throw new Error('unused UI utility'); } };
      if (name === 'dns') return { promises: { Resolver: class {
        async resolve() { return []; }
        setServers() {}
      } } };
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
      if (['crypto', 'dns', 'node:child_process', 'node:url'].includes(name)) return require(name);
      throw new Error('Unexpected dependency: ' + name);
    }
    const code = compile(fs.readFileSync(file, 'utf8'), file);
    new vm.Script(code, { filename: file }).runInNewContext({
      require: requireBoundary, exports: mod.exports, module: mod, Buffer, console,
      performance, Response, Date, Error,
      process: { env: { NODE_ENV: 'production', TASKS_SERVICE_ACCOUNT_EMAIL: 'fixture@example.test',
        GOOGLE_CLOUD_PROJECT_ID: 'fixture', CLOUD_TASKS_QUEUE_NAME: 'fixture',
        CLOUD_FUNCTION_URL: 'https://fixture.example.test/function' } },
    });
    return mod.exports;
  }
  const utils = load('src/lib/utils.ts');
  const utilsServer = load('src/lib/utilsServer.ts');
  const store = load('src/lib/storeEmailSignature.ts');
  const route = load('src/app/api/gmail/route.ts');
  const signingKey = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });

  function rawEmail(domains, subject = 'synthetic ingestion fixture') {
    const baseHeaders = [
      ['From', ' sender@example.test\r\n'], ['To', ' recipient@example.test\r\n'],
      ['Subject', ' ' + subject + '\r\n'], ['Date', ' Sat, 10 Oct 2026 12:00:00 +0000\r\n'],
    ];
    const signatures = domains.map((domain) => {
      const unsigned = 'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=' + domain +
        '; s=old; h=from:to:subject:date; bh=' + crypto.createHash('sha256').update('fixture body\r\n').digest('base64') + '; b=';
      const chunks = [];
      utilsServer.computeCanonicalizedHeaderHash(
        { update: (value) => chunks.push(Buffer.from(value)) },
        utilsServer.canonicalizeHeaders(baseHeaders, 'relaxed'),
        utilsServer.canonicalizeHeaders(utilsServer.parseDkimSignature(unsigned), 'relaxed'),
        'relaxed',
      );
      return unsigned + crypto.sign('sha256', Buffer.concat(chunks), signingKey.privateKey).toString('base64') + '\r\n';
    });
    return signatures.join('') + baseHeaders.map(([k, v]) => k + ':' + v).join('') + '\r\nfixture body\r\n';
  }
  function addMessage(id, domains, subject) {
    const raw = rawEmail(domains, subject);
    messages.set(id, { raw: Buffer.from(raw).toString('base64url'), internalDate: String(Date.parse('2026-10-10T12:00:00Z')) });
    return raw;
  }
  async function seed(domain) {
    const raw = rawEmail([domain], 'earlier signature fixture');
    const sig = utils.getDkimSigsArray(raw)[0];
    await store.processAndStoreEmailSignature(utils.parseEmailHeader(raw), sig,
      utils.parseDkimTagListV2(sig), new Date('2026-10-09T12:00:00Z'), { added: true, already_in_db: false });
  }
  function assertValidStored(row) {
    const digestInfo = crypto.publicDecrypt({ key: signingKey.publicKey, padding: crypto.constants.RSA_NO_PADDING },
      Buffer.from(row.dkimSignature, 'base64'));
    assert.equal(digestInfo.subarray(-32).toString('hex'), row.headerHashV2);
    assert.equal(row.headerHash, row.headerHashV2);
  }
  async function getPage(pageToken) {
    const nextUrl = new URL('https://archive.zk.email/api/gmail');
    if (pageToken) nextUrl.searchParams.set('pageToken', pageToken);
    return route.GET({ nextUrl });
  }
  return { rows, logs, queueCalls, listCalls, messages, addMessage, seed, getPage, assertValidStored,
    utils, rawEmail, postPair: (body) => load('src/app/api/dsp/route.ts').POST({ json: async () => body }) };
}

// Run the exact client fetch closure selected by its TS AST, preserving its
// body. React setters and scheduling are controlled to observe state changes.
function clientFor(world, fetchOverride) {
  const filename = path.join(root, 'src/app/contribute/EmailUploader.tsx');
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(file) === 'fetchFromGmailApiWithQuery') matches.push(n);
    ts.forEachChild(n, visit);
  }
  visit(file);
  assert.equal(matches.length, 1);
  const state = { processed: 0, logs: [], added: 0, error: null, busy: true, cursor: 'resume-cursor', total: 2, scheduled: [] };
  const set = (key) => (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const context = {
    module: { exports: {} }, URLSearchParams, Date, console: { error() {} },
    isPausedRef: { current: false }, totalMessages: state.total,
    setUploadError: set('error'), setTotalMessages: set('total'), setLogResults: set('logs'),
    setProcessedCount: set('processed'), setAddedCount: set('added'),
    setIsProcessingEmails: set('busy'), setApiPageToken: set('cursor'),
    setTimeout: (fn, delay) => state.scheduled.push({ fn, delay }),
    fetch: fetchOverride || (async (url) => world.getPage(new URL(url, 'https://archive.zk.email').searchParams.get('pageToken'))),
  };
  const source = 'const ' + matches[0].getText(file) + '; module.exports = fetchFromGmailApiWithQuery;';
  new vm.Script(compile(source, filename), { filename }).runInNewContext(context);
  return { state, fetchPage: context.module.exports };
}

async function withDebug(action) {
  if (!debug) return action();
  const session = new inspector.Session();
  session.connect();
  const observations = [];
  session.on('Debugger.paused', ({ params }) => {
    const frames = params.callFrames.map((f) => f.functionName).filter(Boolean);
    const observation = { reason: params.reason, exception: params.data?.description?.split('\n')[0], frames, values: [] };
    observations.push(observation);
    for (const frame of params.callFrames) {
      const expression = {
        handleMessage: 'JSON.stringify({domain, selector, signatureCount:dkimSigsArray.length})',
        processAndStoreEmailSignature: 'JSON.stringify({domain, selector, neighbors:dsps.length, resultsBeforeQueue:result.length})',
        handleRequest: 'JSON.stringify({pageToken, isFirstPage})',
      }[frame.functionName];
      if (expression) session.post('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression }, (error, result) => {
        if (!error && !result.exceptionDetails) observation.values.push({ function: frame.functionName, values: JSON.parse(result.result.value) });
      });
    }
    session.post('Debugger.resume');
  });
  session.post('Debugger.enable');
  session.post('Debugger.setPauseOnExceptions', { state: 'all' });
  try { return await action(); }
  finally {
    session.post('Debugger.setPauseOnExceptions', { state: 'none' });
    session.disconnect();
    console.log('DEBUGGER_OBSERVATIONS', JSON.stringify(observations));
  }
}

test('control: missing DNS key still stores a cryptographically usable signature and hash', async () => {
  const w = createWorld();
  w.addMessage('one', ['unknown.example.test']);
  const response = await w.getPage();
  assert.equal(response.status, 200);
  assert.equal(w.rows.length, 1);
  w.assertValidStored(w.rows[0]);
  assert.equal(w.rows[0].domain, 'unknown.example.test');
  assert.equal(w.queueCalls.length, 0);
});

test('control: exact rescan deduplicates evidence without deleting the saved row', async () => {
  const w = createWorld();
  w.addMessage('one', ['unknown.example.test']);
  await w.getPage();
  await w.getPage();
  assert.equal(w.rows.length, 1);
  w.assertValidStored(w.rows[0]);
});

test('control: two signatures with known keys are both saved', async () => {
  const domains = ['first.example.test', 'second.example.test'];
  const w = createWorld({ knownDomains: domains });
  w.addMessage('one', domains);
  const response = await w.getPage();
  assert.equal((await response.json()).addDspResults.length, 2);
  assert.equal(w.rows.length, 2);
  w.rows.forEach(w.assertValidStored);
});

test('queue failure: first unknown signature persists but later signature is skipped', () => withDebug(async () => {
  const w = createWorld({ queueFailure: true, knownDomains: ['second.example.test'] });
  await w.seed('first.example.test');
  const baseline = w.rows.length;
  w.addMessage('one', ['first.example.test', 'second.example.test']);
  const response = await w.getPage();
  const body = await response.json();
  assert.equal(w.queueCalls.length, 1);
  assert.equal(w.rows.filter((r) => r.domain === 'first.example.test').length, 2);
  w.rows.forEach(w.assertValidStored);
  console.log('QUEUE_FAILURE', JSON.stringify({ http: response.status, savedNew: w.rows.length - baseline,
    laterSignatureSaved: w.rows.some((r) => r.domain === 'second.example.test'), messagesProcessed: body.messagesProcessed,
    resultCount: body.addDspResults.length, errors: w.logs.filter((x) => x.event === 'gmail_message_error').map((x) => x.error) }));
  assert.equal(w.rows.length - baseline, expectFixed ? 2 : 1);
}));

test('database insert failure: later valid signature is skipped', async () => {
  const w = createWorld({ insertFailureDomain: 'first.example.test', knownDomains: ['first.example.test', 'second.example.test'] });
  w.addMessage('one', ['first.example.test', 'second.example.test']);
  await w.getPage();
  assert.equal(w.rows.some((r) => r.domain === 'second.example.test'), expectFixed);
});

test('DNS-path database failure: persistence is not reached for current or later signature', async () => {
  const w = createWorld({ dnsDatabaseFailureDomain: 'first.example.test', knownDomains: ['second.example.test'] });
  w.addMessage('one', ['first.example.test', 'second.example.test']);
  await w.getPage();
  assert.equal(w.rows.length, expectFixed ? 2 : 0);
});

test('failed message: API and client count failure without communicating it', () => withDebug(async () => {
  const w = createWorld({ fetchFailureId: 'bad', knownDomains: ['good.example.test'] });
  w.addMessage('good', ['good.example.test']);
  w.addMessage('bad', ['lost.example.test']);
  const response = await w.getPage();
  const body = await response.json();
  const client = clientFor(w);
  await client.fetchPage(null, null);
  console.log('FAILED_MESSAGE', JSON.stringify({ http: response.status, messagesProcessed: body.messagesProcessed,
    successfulSignatureResults: body.addDspResults.length, storedRows: w.rows.length, messagesFailed: body.messagesFailed ?? null,
    clientProcessed: client.state.processed, clientError: client.state.error, clientBusy: client.state.busy }));
  assert.equal(w.rows.length, 1);
  assert.equal(body.messagesProcessed, 2);
  assert.equal(body.addDspResults.length, 1);
  if (expectFixed) assert.equal(body.messagesFailed, 1);
  else {
    assert.equal(body.messagesFailed, undefined);
    assert.equal(client.state.processed, 2);
    assert.equal(client.state.error, null);
    assert.equal(client.state.busy, false);
  }
}));

test('listing failure: HTTP 200 empty page clears client cursor as if scan finished', () => withDebug(async () => {
  const w = createWorld({ listFailure: true });
  const response = await w.getPage('resume-cursor');
  const body = await response.json();
  const client = clientFor(w);
  await client.fetchPage(null, 'resume-cursor');
  console.log('LIST_FAILURE', JSON.stringify({ http: response.status, body, requestCursor: w.listCalls[0].pageToken,
    clientError: client.state.error, clientCursor: client.state.cursor, clientBusy: client.state.busy }));
  if (expectFixed) assert.equal(response.status, 503);
  else {
    assert.equal(response.status, 200);
    assert.equal(body.messagesProcessed, 0);
    assert.equal(body.nextPageToken, null);
    assert.equal(client.state.cursor, null);
    assert.equal(client.state.error, null);
    assert.equal(client.state.busy, false);
  }
}));

test('control: real empty final page correctly ends the scan', async () => {
  const w = createWorld();
  const client = clientFor(w);
  await client.fetchPage(null, 'resume-cursor');
  assert.equal(client.state.error, null);
  assert.equal(client.state.cursor, null);
  assert.equal(client.state.busy, false);
});

test('control: client already displays non-2xx errors and retains its retry cursor', async () => {
  const w = createWorld();
  const client = clientFor(w, async () => Response.json({ message: 'Gmail listing temporarily failed' }, { status: 503 }));
  await client.fetchPage(null, 'resume-cursor');
  assert.equal(client.state.error, 'Gmail listing temporarily failed');
  assert.equal(client.state.cursor, 'resume-cursor');
  assert.equal(client.state.processed, 0);
});

async function filePairsClient(world, pairs) {
  const filename = path.join(root, 'src/app/contribute/EmailUploader.tsx');
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(file) === 'submitPairs') matches.push(n);
    ts.forEachChild(n, visit);
  }
  visit(file);
  assert.equal(matches.length, 1);
  const state = { processed: 0, total: 0, logs: [], added: 0, sent: [], statuses: [] };
  const setter = (key) => (v) => { state[key] = typeof v === 'function' ? v(state[key]) : v; };
  const context = {
    module: { exports: {} }, Date, JSON, console: { error() {} },
    setTotalMessages: setter('total'), setProcessedCount: setter('processed'),
    setLogResults: setter('logs'), setAddedCount: setter('added'),
    fetch: async (url, options) => {
      assert.equal(url, '/api/dsp');
      const body = JSON.parse(options.body);
      state.sent.push(body);
      const response = await world.postPair(body);
      state.statuses.push(response.status);
      return response;
    },
  };
  const source = 'const ' + matches[0].getText(file) + '; module.exports = submitPairs;';
  new vm.Script(compile(source, filename), { filename }).runInNewContext(context);
  await context.module.exports(pairs, 'mailbox');
  return state;
}

test('additional path: mailbox upload sends selector discovery only, not signature/hash evidence', async () => {
  const w = createWorld();
  const mailbox = 'From sender Sat Oct 10 12:00:00 2026\n' + w.rawEmail(['unknown.example.test'], 'first message') +
    'From sender Sat Oct 10 12:00:01 2026\n' + w.rawEmail(['unknown.example.test'], 'different second message');
  const pairs = w.utils.parseMailboxPairs(mailbox);
  assert.equal(pairs.length, 1);
  const state = await filePairsClient(w, pairs);
  assert.deepEqual(state.sent, [{ domain: 'unknown.example.test', selector: 'old' }]);
  assert.equal(w.rows.length, 0);
  console.log('MAILBOX_PATH', JSON.stringify({ inputMessages: 2, uniquePairs: pairs.length,
    transmittedFields: Object.keys(state.sent[0]), savedSignatureRows: w.rows.length, http: state.statuses }));
});

test('additional path: mailbox upload treats a 429 response as a normal log row', async () => {
  const w = createWorld({ dspRateLimit: true });
  const state = await filePairsClient(w, [{ domain: 'unknown.example.test', selector: 'old' }]);
  assert.deepEqual(state.statuses, [429]);
  assert.equal(state.processed, 1);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].isAdded, false);
  console.log('MAILBOX_429', JSON.stringify({ http: state.statuses, processed: state.processed,
    ordinaryLogRows: state.logs.length, savedSignatureRows: w.rows.length }));
});
