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
const debug = process.env.AUDIT_DEBUG === '1';
const sourceFiles = [
  'src/app/api/gmail/route.ts',
  'src/app/api/email/route.ts',
  'src/lib/ingestEmail.ts',
  'src/lib/storeEmailSignature.ts',
  'src/lib/utils.ts',
  'src/lib/utilsServer.ts',
  'src/lib/dkimHeaderHash.ts',
  'src/app/contribute/EmailUploader.tsx',
];
console.log(
  'SOURCE_HASHES',
  JSON.stringify(
    Object.fromEntries(
      sourceFiles.map((f) => [
        f,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(root, f)))
          .digest('hex'),
      ])
    )
  )
);

// Compile full real modules. Only network/framework/DB boundaries are replaced.
function compile(source, file) {
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
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
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (event, properties) => logs.push({ level, event, ...properties }),
    ])
  );
  const prisma = {
    domainSelectorPair: {
      findFirst: async ({ where }) => {
        if (options.dnsDatabaseFailureDomain === where.domain)
          throw new Error('domain-selector database unavailable');
        return options.knownDomains?.includes(where.domain)
          ? { id: 1, ...where, lastRecordUpdate: new Date() }
          : null;
      },
    },
    $executeRaw: async (strings, ...values) => {
      assert.match(strings.join('?'), /INSERT INTO "EmailSignature"/);
      const [
        domain,
        selector,
        headerHash,
        headerHashV2,
        dkimSignature,
        timestamp,
        signingAlgorithm,
        canonInfo,
      ] = values;
      if (options.insertFailureDomain === domain)
        throw new Error('database insert unavailable');
      if (
        rows.some(
          (r) =>
            r.headerHashV2 === headerHashV2 && r.dkimSignature === dkimSignature
        )
      )
        return 0;
      rows.push({
        id: rows.length + 1,
        domain,
        selector,
        headerHash,
        headerHashV2,
        dkimSignature,
        timestamp,
        signingAlgorithm,
        canonInfo,
      });
      return 1;
    },
    emailSignature: {
      findMany: async ({ where, take, orderBy }) =>
        rows
          .filter((r) => {
            if (r.domain.toLowerCase() !== where.domain.equals.toLowerCase())
              return false;
            if (
              r.selector.toLowerCase() !== where.selector.equals.toLowerCase()
            )
              return false;
            if (where.timestamp.gt && !(r.timestamp > where.timestamp.gt))
              return false;
            if (where.timestamp.lt && !(r.timestamp < where.timestamp.lt))
              return false;
            return true;
          })
          .sort(
            (a, b) =>
              (orderBy.timestamp === 'asc' ? 1 : -1) *
              (a.timestamp - b.timestamp)
          )
          .slice(0, take),
    },
  };
  const provider = {
    users: {
      getProfile: async () => ({ data: { messagesTotal: messages.size } }),
      messages: {
        list: async (params) => {
          listCalls.push(params);
          if (options.listFailure)
            throw Object.assign(new Error('Gmail API: listing failed'), {
              code: options.listFailureCode || 503,
            });
          return {
            data: {
              messages: [...messages.keys()].map((id) => ({ id })),
              nextPageToken: options.nextPageToken ?? null,
            },
          };
        },
        get: async ({ id }) => {
          if (options.fetchFailureId === id)
            throw new Error('Gmail API: message fetch unavailable (503)');
          return { data: messages.get(id) };
        },
      },
    },
  };
  const NextResponse = { json: (body, init) => Response.json(body, init) };
  function load(relative) {
    const file = path.join(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    function requireBoundary(name) {
      if (name === 'react' || name === 'react/jsx-runtime')
        return require(name);
      if (name === '@phosphor-icons/react')
        return Object.fromEntries(
          ['PauseCircleIcon', 'PlayIcon', 'TrashIcon'].map((name) => [
            name,
            () => null,
          ])
        );
      if (
        name === '@/components/ui/button' ||
        name === '@/components/ui/scroll-area' ||
        name.endsWith('/ui/badge')
      ) {
        const component = ({ children }) =>
          require('react').createElement('div', null, children);
        return { Button: component, ScrollArea: component, Badge: component };
      }
      if (name === 'zod') return { z };
      if (name === 'next/server') return { NextResponse };
      if (name === 'next/headers')
        return {
          headers: async () => new Headers({ host: 'archive.zk.email' }),
        };
      if (name === '@/auth')
        return {
          auth: async () => ({
            user: { email: 'fixture@example.test' },
            accessToken: 'synthetic-fixture-token',
            hasGmailScope: true,
          }),
        };
      if (name === '@/lib/client-identity')
        return {
          CONTRIBUTE_BUDGET: {},
          resolveClientIdentity: async () => ({
            type: 'fixture',
            identifier: 'synthetic',
          }),
          checkClientRateLimit: async () =>
            options.dspRateLimit
              ? {
                  allowed: false,
                  limit: 10,
                  windowSeconds: 60,
                  retryAfterSeconds: 60,
                }
              : { allowed: true },
        };
      if (name === 'googleapis')
        return {
          google: {
            auth: {
              OAuth2: class {
                setCredentials() {}
              },
            },
            gmail: () => provider,
          },
        };
      if (name === '@zk-email/helpers/dist/dkim')
        return {
          verifyDKIMSignature: async () => {
            throw new Error('DNS: public key not found');
          },
        };
      if (name === '@/generated/prisma/client')
        return { Prisma: { QueryMode: { insensitive: 'insensitive' } } };
      if (name.endsWith('/logger') || name === './logger') return { logger };
      if (name === './db' || name === '@/lib/db') return { prisma };
      if (name === '@google-cloud/tasks')
        return {
          CloudTasksClient: class {
            queuePath() {
              return 'projects/fixture/locations/us-central1/queues/fixture';
            }
            async createTask({ task }) {
              queueCalls.push(
                JSON.parse(
                  Buffer.from(task.httpRequest.body, 'base64').toString()
                )
              );
              if (options.queueFailure)
                throw new Error('Could not load the default credentials');
              return [{ name: 'fixture-task' }];
            }
          },
        };
      if (name === 'clsx')
        return {
          clsx: () => {
            throw new Error('unused UI utility');
          },
        };
      if (name === 'tailwind-merge')
        return {
          twMerge: () => {
            throw new Error('unused UI utility');
          },
        };
      if (name === 'dns')
        return {
          promises: {
            Resolver: class {
              async resolve() {
                return [];
              }
              setServers() {}
            },
          },
        };
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.'))
        return load(
          path.relative(root, path.resolve(path.dirname(file), name + '.ts'))
        );
      if (['crypto', 'dns', 'node:child_process', 'node:url'].includes(name))
        return require(name);
      throw new Error('Unexpected dependency: ' + name);
    }
    let code = compile(fs.readFileSync(file, 'utf8'), file);
    if (debug)
      code = code.replace(
        'const dsps = [...futureEmailSigs, ...pastEmailSigs];',
        '$&\ndebugger;'
      );
    new vm.Script(code, { filename: file }).runInNewContext({
      require: requireBoundary,
      exports: mod.exports,
      module: mod,
      Buffer,
      crypto: crypto.webcrypto,
      TextEncoder,
      Uint8Array,
      console,
      performance,
      Response,
      Date,
      Error,
      process: {
        env: {
          NODE_ENV: 'production',
          TASKS_SERVICE_ACCOUNT_EMAIL: 'fixture@example.test',
          GOOGLE_CLOUD_PROJECT_ID: 'fixture',
          CLOUD_TASKS_QUEUE_NAME: 'fixture',
          CLOUD_FUNCTION_URL: 'https://fixture.example.test/function',
        },
      },
    });
    return mod.exports;
  }
  const utils = load('src/lib/utils.ts');
  const utilsServer = load('src/lib/utilsServer.ts');
  const store = load('src/lib/storeEmailSignature.ts');
  const route = load('src/app/api/gmail/route.ts');
  const signingKey = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });

  function rawEmail(
    domains,
    subject = 'synthetic ingestion fixture',
    canon = 'relaxed'
  ) {
    const baseHeaders = [
      ['From', ' sender@example.test\r\n'],
      ['To', ' recipient@example.test\r\n'],
      ['Subject', ' ' + subject + '\r\n'],
      ['Date', ' Sat, 10 Oct 2026 12:00:00 +0000\r\n'],
    ];
    const signatures = domains.map((domain) => {
      const unsigned =
        'DKIM-Signature: v=1; a=rsa-sha256; c=' +
        canon +
        '/relaxed; d=' +
        domain +
        '; s=old; h=from:to:subject:date; bh=' +
        crypto
          .createHash('sha256')
          .update('fixture body\r\n')
          .digest('base64') +
        '; b=';
      const chunks = [];
      utilsServer.computeCanonicalizedHeaderHash(
        { update: (value) => chunks.push(Buffer.from(value)) },
        utilsServer.canonicalizeHeaders(baseHeaders, canon),
        utilsServer.canonicalizeHeaders(
          utilsServer.parseDkimSignature(unsigned),
          canon
        ),
        canon
      );
      return (
        unsigned +
        crypto
          .sign('sha256', Buffer.concat(chunks), signingKey.privateKey)
          .toString('base64') +
        '\r\n'
      );
    });
    return (
      signatures.join('') +
      baseHeaders.map(([k, v]) => k + ':' + v).join('') +
      '\r\nfixture body\r\n'
    );
  }
  function addMessage(id, domains, subject) {
    const raw = rawEmail(domains, subject);
    messages.set(id, {
      raw: Buffer.from(raw).toString('base64url'),
      internalDate: String(Date.parse('2026-10-10T12:00:00Z')),
    });
    return raw;
  }
  async function seed(domain) {
    const raw = rawEmail([domain], 'earlier signature fixture');
    const sig = utils.getDkimSigsArray(raw)[0];
    await store.processAndStoreEmailSignature(
      utils.parseEmailHeader(raw),
      sig,
      utils.parseDkimTagListV2(sig),
      new Date('2026-10-09T12:00:00Z'),
      { added: true, already_in_db: false }
    );
  }
  function assertValidStored(row) {
    const digestInfo = crypto.publicDecrypt(
      { key: signingKey.publicKey, padding: crypto.constants.RSA_NO_PADDING },
      Buffer.from(row.dkimSignature, 'base64')
    );
    assert.equal(
      digestInfo
        .subarray(
          -{ 'rsa-sha1': 20, 'rsa-sha256': 32, 'rsa-sha512': 64 }[
            row.signingAlgorithm
          ]
        )
        .toString('hex'),
      row.headerHashV2
    );
    assert.equal(row.headerHash, row.headerHashV2);
  }
  async function getPage(pageToken) {
    const nextUrl = new URL('https://archive.zk.email/api/gmail');
    if (pageToken) nextUrl.searchParams.set('pageToken', pageToken);
    return route.GET({ nextUrl });
  }
  return {
    rows,
    logs,
    queueCalls,
    listCalls,
    messages,
    addMessage,
    seed,
    getPage,
    assertValidStored,
    utils,
    ProcessedLogs: () => load('src/app/contribute/ProcessedLogs.tsx').default,
    rawEmail,
    postEmail: (body) =>
      load('src/app/api/email/route.ts').POST(
        body instanceof Request
          ? body
          : new Request('https://archive.zk.email/api/email', {
              method: 'POST',
              body: JSON.stringify(body),
            })
      ),
    postPair: (body) =>
      load('src/app/api/dsp/route.ts').POST({ json: async () => body }),
  };
}

// Run the exact client fetch closure selected by its TS AST, preserving its
// body. React setters and scheduling are controlled to observe state changes.
function clientFor(world, fetchOverride) {
  const filename = path.join(root, 'src/app/contribute/EmailUploader.tsx');
  const file = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const matches = [];
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === 'fetchFromGmailApiWithQuery'
    )
      matches.push(n);
    ts.forEachChild(n, visit);
  }
  visit(file);
  assert.equal(matches.length, 1);
  const state = {
    processed: 0,
    logs: [],
    added: 0,
    error: null,
    busy: true,
    cursor: 'resume-cursor',
    total: 2,
    recoveryFailures: 0,
    scheduled: [],
  };
  const set = (key) => (value) => {
    state[key] = typeof value === 'function' ? value(state[key]) : value;
  };
  const context = {
    module: { exports: {} },
    URLSearchParams,
    Date,
    console: { error() {} },
    isPausedRef: { current: false },
    totalMessages: state.total,
    setUploadError: set('error'),
    setTotalMessages: set('total'),
    setLogResults: set('logs'),
    setProcessedCount: set('processed'),
    setAddedCount: set('added'),
    setRecoveryFailureCount: set('recoveryFailures'),
    setIsProcessingEmails: set('busy'),
    setApiPageToken: set('cursor'),
    setTimeout: (fn, delay) => state.scheduled.push({ fn, delay }),
    fetch:
      fetchOverride ||
      (async (url) =>
        world.getPage(
          new URL(url, 'https://archive.zk.email').searchParams.get('pageToken')
        )),
  };
  const source =
    'const ' +
    matches[0].getText(file) +
    '; module.exports = fetchFromGmailApiWithQuery;';
  new vm.Script(compile(source, filename), { filename }).runInNewContext(
    context
  );
  return { state, fetchPage: context.module.exports };
}

async function withDebug(action) {
  if (!debug) return action();
  const session = new inspector.Session();
  session.connect();
  const observations = [];
  session.on('Debugger.paused', ({ params }) => {
    const frames = params.callFrames.map((f) => f.functionName).filter(Boolean);
    const observation = {
      reason: params.reason,
      exception: params.data?.description?.split('\n')[0],
      frames,
      values: [],
    };
    observations.push(observation);
    for (const frame of params.callFrames) {
      const expression = {
        handleMessage:
          'JSON.stringify({domain, selector, signatureCount:dkimSigsArray.length})',
        processAndStoreEmailSignature:
          'JSON.stringify({domain, selector, neighbors:dsps.length, distinctNeighbors:new Set(dsps.map(row => row.id)).size, undated:timestamp === null})',
        handleRequest: 'JSON.stringify({pageToken, isFirstPage})',
      }[frame.functionName];
      if (expression)
        session.post(
          'Debugger.evaluateOnCallFrame',
          { callFrameId: frame.callFrameId, expression },
          (error, result) => {
            if (!error && !result.exceptionDetails)
              observation.values.push({
                function: frame.functionName,
                values: JSON.parse(result.result.value),
              });
          }
        );
    }
    session.post('Debugger.resume');
  });
  session.post('Debugger.enable');
  session.post('Debugger.setPauseOnExceptions', { state: 'all' });
  try {
    return await action();
  } finally {
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

test('queue failure: queue failure preserves both signatures and reports recovery failure', () =>
  withDebug(async () => {
    const w = createWorld({
      queueFailure: true,
      knownDomains: ['second.example.test'],
    });
    await w.seed('first.example.test');
    const baseline = w.rows.length;
    w.addMessage('one', ['first.example.test', 'second.example.test']);
    const response = await w.getPage();
    const body = await response.json();
    assert.equal(w.queueCalls.length, 1);
    assert.equal(
      w.rows.filter((r) => r.domain === 'first.example.test').length,
      2
    );
    w.rows.forEach(w.assertValidStored);
    console.log(
      'QUEUE_FAILURE',
      JSON.stringify({
        http: response.status,
        savedNew: w.rows.length - baseline,
        laterSignatureSaved: w.rows.some(
          (r) => r.domain === 'second.example.test'
        ),
        messagesProcessed: body.messagesProcessed,
        resultCount: body.addDspResults.length,
        errors: w.logs
          .filter((x) => x.event === 'gmail_message_error')
          .map((x) => x.error),
      })
    );
    assert.equal(w.rows.length - baseline, 2);
    assert.equal(body.recoveryFailures, 1);
    assert.equal(body.messagesFailed, 0);
    const client = clientFor(w, async () => Response.json(body));
    await client.fetchPage(null, null);
    assert.equal(client.state.recoveryFailures, 1);
    assert.equal(client.state.error, null);
  }));

test('database insertion failure is isolated from later valid signature', async () => {
  const w = createWorld({
    insertFailureDomain: 'first.example.test',
    knownDomains: ['first.example.test', 'second.example.test'],
  });
  w.addMessage('one', ['first.example.test', 'second.example.test']);
  await w.getPage();
  assert.equal(
    w.rows.some((r) => r.domain === 'second.example.test'),
    true
  );
});

test('DNS lookup failure does not block either signature insert', async () => {
  const w = createWorld({
    dnsDatabaseFailureDomain: 'first.example.test',
    knownDomains: ['second.example.test'],
  });
  w.addMessage('one', ['first.example.test', 'second.example.test']);
  await w.getPage();
  assert.equal(w.rows.length, 2);
});

test('failed message is reported and stops page advancement', () =>
  withDebug(async () => {
    const w = createWorld({
      fetchFailureId: 'bad',
      knownDomains: ['good.example.test'],
    });
    w.addMessage('good', ['good.example.test']);
    w.addMessage('bad', ['lost.example.test']);
    const response = await w.getPage();
    const body = await response.json();
    const client = clientFor(w);
    await client.fetchPage(null, null);
    console.log(
      'FAILED_MESSAGE',
      JSON.stringify({
        http: response.status,
        messagesProcessed: body.messagesProcessed,
        successfulSignatureResults: body.addDspResults.length,
        storedRows: w.rows.length,
        messagesFailed: body.messagesFailed ?? null,
        clientProcessed: client.state.processed,
        clientError: client.state.error,
        clientBusy: client.state.busy,
      })
    );
    assert.equal(w.rows.length, 1);
    assert.equal(body.messagesProcessed, 2);
    assert.equal(body.addDspResults.length, 1);
    assert.equal(body.messagesFailed, 1);
    assert.equal(body.messagesSucceeded, 1);
    assert.equal(client.state.processed, 0);
    assert.match(client.state.error, /1 of 2 messages/);
    assert.equal(client.state.busy, false);
  }));

test('listing failure is non-success and preserves the resume cursor', () =>
  withDebug(async () => {
    const w = createWorld({ listFailure: true });
    const response = await w.getPage('resume-cursor');
    const body = await response.json();
    const client = clientFor(w);
    await client.fetchPage(null, 'resume-cursor');
    console.log(
      'LIST_FAILURE',
      JSON.stringify({
        http: response.status,
        body,
        requestCursor: w.listCalls[0].pageToken,
        clientError: client.state.error,
        clientCursor: client.state.cursor,
        clientBusy: client.state.busy,
      })
    );
    assert.equal(response.status, 503);
    assert.equal(client.state.cursor, 'resume-cursor');
    assert.match(client.state.error, /Could not list Gmail/);
    assert.equal(client.state.busy, false);
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
  const client = clientFor(w, async () =>
    Response.json(
      { message: 'Gmail listing temporarily failed' },
      { status: 503 }
    )
  );
  await client.fetchPage(null, 'resume-cursor');
  assert.equal(client.state.error, 'Gmail listing temporarily failed');
  assert.equal(client.state.cursor, 'resume-cursor');
  assert.equal(client.state.processed, 0);
});

async function fileClient(world, content, mode = 'mailbox') {
  const filename = path.join(root, 'src/app/contribute/EmailUploader.tsx');
  const file = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const names = ['submitPairs', 'submitEvidence', 'handleProcessFile'];
  const declarations = new Map();
  function visit(n) {
    if (ts.isVariableDeclaration(n) && names.includes(n.name.getText(file)))
      declarations.set(n.name.getText(file), n);
    ts.forEachChild(n, visit);
  }
  visit(file);
  assert.equal(declarations.size, names.length);
  const state = {
    processed: 0,
    total: 0,
    logs: [],
    added: 0,
    sent: [],
    statuses: [],
    error: null,
    recoveryFailures: 0,
  };
  const setter = (key) => (v) => {
    state[key] = typeof v === 'function' ? v(state[key]) : v;
  };
  const cursor = { current: 0 };
  const context = {
    module: { exports: {} },
    Date,
    JSON,
    Error,
    console: { error() {} },
    file: {},
    uploadMode: mode,
    fileResumeIndexRef: cursor,
    getFileContent: async () => content,
    parseMailboxEvidence: world.utils.parseMailboxEvidence,
    parseTsvPairs: world.utils.parseTsvPairs,
    setTotalMessages: setter('total'),
    setProcessedCount: setter('processed'),
    setLogResults: setter('logs'),
    setAddedCount: setter('added'),
    setUploadError: setter('error'),
    setRecoveryFailureCount: setter('recoveryFailures'),
    setUploadStarted() {},
    setIsProcessingEmails: setter('busy'),
    setIsDataFetching() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      state.sent.push(body);
      const response =
        url === '/api/email'
          ? await world.postEmail(body)
          : await world.postPair(body);
      state.statuses.push(response.status);
      return response;
    },
  };
  const source =
    names
      .map((name) => 'const ' + declarations.get(name).getText(file) + ';')
      .join('\n') + 'module.exports = handleProcessFile;';
  new vm.Script(compile(source, filename), { filename }).runInNewContext(
    context
  );
  await context.module.exports();
  return { state, cursor, retry: context.module.exports };
}

test('mailbox upload retains two signatures under one selector without sending bodies', async () => {
  const w = createWorld();
  const mailbox =
    'From sender Sat Oct 10 12:00:00 2026\n' +
    w.rawEmail(['unknown.example.test'], 'first message') +
    'From sender Sat Oct 10 12:00:01 2026\n' +
    w.rawEmail(['unknown.example.test'], 'different second message');
  const { state } = await fileClient(w, mailbox);
  assert.equal(w.rows.length, 2);
  w.rows.forEach(w.assertValidStored);
  assert.equal(state.error, null);
  assert.equal(state.processed, 2);
  assert.equal(state.sent.length, 2);
  for (const body of state.sent) {
    assert.deepEqual(Object.keys(body).sort(), [
      'dkimSignature',
      'domain',
      'headerHash',
      'selector',
      'signingAlgorithm',
      'timestamp',
    ]);
  }
});

test('TSV rate limit is visible and retries failed pair without a success log', async () => {
  const options = { dspRateLimit: true };
  const w = createWorld(options);
  const client = await fileClient(w, 'unknown.example.test\told', 'tsv');
  assert.deepEqual(client.state.statuses, [429]);
  assert.equal(client.state.processed, 0);
  assert.equal(client.state.logs.length, 0);
  assert.match(client.state.error, /HTTP 429/);
  assert.equal(client.cursor.current, 0);
  options.dspRateLimit = false;
  await client.retry();
  assert.equal(client.state.processed, 1);
  assert.equal(client.state.error, null);
});

test('mailbox retry resumes failed message without resending prior saved messages', async () => {
  const options = { insertFailureDomain: 'second.example.test' };
  const w = createWorld(options);
  const mailbox =
    'From sender Sat Oct 10 12:00:00 2026\n' +
    w.rawEmail(['first.example.test']) +
    'From sender Sat Oct 10 12:00:01 2026\n' +
    w.rawEmail(['second.example.test']);
  const client = await fileClient(w, mailbox);
  assert.equal(w.rows.length, 1);
  assert.equal(client.state.processed, 1);
  assert.equal(client.cursor.current, 1);
  assert.match(client.state.error, /HTTP 503/);
  options.insertFailureDomain = undefined;
  await client.retry();
  assert.equal(w.rows.length, 2);
  assert.equal(client.state.sent.length, 3);
  assert.equal(client.state.processed, 2);
  assert.equal(client.state.error, null);
});

test('mailbox simple canonicalization preserves last signed header line ending', async () => {
  const w = createWorld();
  const client = await fileClient(
    w,
    w.rawEmail(['unknown.example.test'], 'simple fixture', 'simple')
  );
  assert.equal(client.state.error, null);
  assert.equal(w.rows.length, 1);
  w.assertValidStored(w.rows[0]);
});

test('header-only ingestion rejects an email body', async () => {
  const w = createWorld();
  const response = await w.postEmail({
    headers: w.rawEmail(['unknown.example.test']),
    timestamp: null,
  });
  assert.equal(response.status, 400);
  assert.equal(w.rows.length, 0);
});

test('Gmail preserves authentication and rate-limit error statuses', async () => {
  for (const code of [401, 403, 429]) {
    const w = createWorld({ listFailure: true, listFailureCode: code });
    assert.equal((await w.getPage('resume-cursor')).status, code);
  }
});

test('partial Gmail page retries without duplicate rows or inflated progress', async () => {
  const options = {
    fetchFailureId: 'bad',
    knownDomains: ['good.example.test', 'other.example.test'],
  };
  const w = createWorld(options);
  w.addMessage('good', ['good.example.test']);
  w.addMessage('bad', ['other.example.test']);
  const client = clientFor(w);
  await client.fetchPage(null, 'resume-cursor');
  assert.equal(w.rows.length, 1);
  assert.equal(client.state.processed, 0);
  assert.equal(client.state.cursor, 'resume-cursor');
  options.fetchFailureId = undefined;
  await client.fetchPage(null, 'resume-cursor');
  assert.equal(w.rows.length, 2);
  assert.equal(client.state.processed, 2);
  assert.equal(client.state.error, null);
});

test('mailbox evidence endpoint applies contribution rate limits', async () => {
  const w = createWorld({ dspRateLimit: true });
  const response = await w.postEmail({
    headers: 'DKIM-Signature: d=x.test; s=old;\r\n',
    timestamp: null,
  });
  assert.equal(response.status, 429);
  assert.equal(w.rows.length, 0);
});

test('last-position DKIM signature survives a header-only mailbox upload', async () => {
  const w = createWorld();
  const raw = w.rawEmail(['unknown.example.test'], 'last DKIM', 'simple');
  const firstEnd = raw.indexOf('\r\n');
  const signature = raw.slice(0, firstEnd);
  const rest = raw.slice(firstEnd + 2);
  const separator = rest.indexOf('\r\n\r\n');
  const reordered =
    rest.slice(0, separator + 2) +
    signature +
    '\r\n' +
    rest.slice(separator + 2);
  await fileClient(w, reordered);
  assert.equal(w.rows.length, 1);
  w.assertValidStored(w.rows[0]);
});

test('DKIM-looking text in the body is not ingested as another signature', async () => {
  const w = createWorld();
  const raw = w.addMessage('one', ['unknown.example.test']);
  const message = w.messages.get('one');
  message.raw = Buffer.from(
    raw +
      '\r\nDKIM-Signature: d=unrelated.example.test; s=fake; b=abc;\r\nOther: text\r\n'
  ).toString('base64url');
  await w.getPage();
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].domain, 'unknown.example.test');
});

test('undated header upload stores evidence without pairing the signature with itself', async () => {
  const w = createWorld({ queueFailure: true });
  const evidence = (
    await w.utils.parseMailboxEvidence(w.rawEmail(['unknown.example.test']))
  )[0];
  const response = await withDebug(() =>
    w.postEmail({ ...evidence, timestamp: null })
  );
  assert.equal(response.status, 200);
  assert.equal(w.rows.length, 1);
  assert.equal(w.queueCalls.length, 0);
  w.assertValidStored(w.rows[0]);
});

test('rendered log heading distinguishes incomplete and completed uploads', () => {
  const w = createWorld();
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const props = {
    logResults: [
      {
        id: 'fixture',
        domain: 'unknown.example.test',
        selector: 'old',
        timestamp: '2026-10-10',
      },
    ],
    isProcessing: false,
  };
  const incomplete = renderToStaticMarkup(
    React.createElement(w.ProcessedLogs(), { ...props, hasError: true })
  );
  assert.match(incomplete, /Upload incomplete/);
  assert.doesNotMatch(incomplete, /Upload complete/);
  const complete = renderToStaticMarkup(
    React.createElement(w.ProcessedLogs(), props)
  );
  assert.match(complete, /Upload complete/);
});

test('rendered unknown-key evidence is labelled as a saved signature', () => {
  const w = createWorld();
  const React = require('react');
  const html = require('react-dom/server').renderToStaticMarkup(
    React.createElement(w.ProcessedLogs(), {
      logResults: [
        {
          id: 'fixture',
          domain: 'unknown.example.test',
          selector: 'old',
          timestamp: '2026-10-10',
          signatureStatus: 'stored',
          isAdded: false,
          isUpdated: false,
        },
      ],
    })
  );
  assert.match(html, /Signature saved/);
});

test('mailbox upload sends no raw header values', async () => {
  const w = createWorld();
  const client = await fileClient(
    w,
    w.rawEmail(['unknown.example.test'], 'private subject')
  );
  const serialized = JSON.stringify(client.state.sent);
  for (const privateText of [
    'private subject',
    'sender@example.test',
    'recipient@example.test',
    'fixture body',
  ]) {
    assert.ok(
      !serialized.includes(privateText),
      'uploaded private header/body value: ' + privateText
    );
  }
  assert.equal(w.rows.length, 1);
  w.assertValidStored(w.rows[0]);
});

test('undated signature schedules each distinct neighbor only once', async () => {
  const w = createWorld();
  await w.seed('unknown.example.test');
  const evidence = (
    await w.utils.parseMailboxEvidence(w.rawEmail(['unknown.example.test']))
  )[0];
  const response = await withDebug(() =>
    w.postEmail({ ...evidence, timestamp: null })
  );
  assert.equal(response.status, 200);
  assert.equal(w.rows.length, 2);
  assert.equal(w.queueCalls.length, 1);
});

test('one email with twelve DKIM signatures retains every signature', async () => {
  const w = createWorld();
  const domains = Array.from(
    { length: 12 },
    (_, i) => `signer${i}.example.test`
  );
  const client = await fileClient(w, w.rawEmail(domains));
  assert.equal(client.state.error, null);
  assert.equal(w.rows.length, 12);
  assert.equal(client.state.sent.length, 12);
  for (const row of w.rows) w.assertValidStored(row);
});

test('browser hashes match independently signed repeated, oversigned and folded headers', async () => {
  const w = createWorld();
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  for (const canon of ['simple', 'relaxed']) {
    for (const algorithm of ['rsa-sha1', 'rsa-sha256', 'rsa-sha512']) {
      const unsigned = `DKIM-Signature: v=1; a=${algorithm}; c=${canon}/simple; d=unknown.example.test; s=selector.with.dots; h=from:subject:subject:subject:date; bh=abc; b=`;
      const from = 'From: sender@example.test\r\n';
      const first = 'Subject: private café\r\n';
      const last = 'Subject: second\r\n\tprivate subject\r\n';
      const date = 'Date: Sat, 10 Oct 2026 12:00:00 +0000\r\n';
      const signed =
        canon === 'simple'
          ? from + last + first + date + unsigned
          : 'from:sender@example.test\r\nsubject:second private subject\r\nsubject:private café\r\ndate:Sat, 10 Oct 2026 12:00:00 +0000\r\n' +
            unsigned
              .toLowerCase()
              .replace('dkim-signature: ', 'dkim-signature:');
      const digest = crypto
        .createHash(algorithm.replace('rsa-', ''))
        .update(signed)
        .digest('hex');
      const signature = crypto
        .sign(
          algorithm.replace('rsa-', ''),
          Buffer.from(signed),
          key.privateKey
        )
        .toString('base64');
      const raw =
        unsigned +
        signature +
        '\r\n' +
        from +
        first +
        last +
        date +
        '\r\nprivate body';
      const evidence = await w.utils.parseMailboxEvidence(raw);
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].headerHash, digest);
      assert.equal((await w.postEmail(evidence[0])).status, 200);
      const decrypted = crypto.publicDecrypt(
        { key: key.publicKey, padding: crypto.constants.RSA_NO_PADDING },
        Buffer.from(evidence[0].dkimSignature, 'base64')
      );
      assert.equal(
        decrypted.subarray(-digest.length / 2).toString('hex'),
        digest
      );
    }
  }
});

test('evidence endpoint rejects batches, raw headers, wrong digest lengths and oversized bodies', async () => {
  const w = createWorld();
  const evidence = (
    await w.utils.parseMailboxEvidence(w.rawEmail(['unknown.example.test']))
  )[0];
  for (const payload of [
    [evidence, evidence],
    { ...evidence, headers: 'Subject: private' },
    { ...evidence, headerHash: 'ff' },
    { ...evidence, dkimSignature: 'a'.repeat(9000) },
  ])
    assert.equal((await w.postEmail(payload)).status, 400);
  assert.equal(w.rows.length, 0);
  assert.equal(w.queueCalls.length, 0);
});

test('file and Gmail rescans deduplicate the same folded signature evidence', async () => {
  const w = createWorld();
  const raw = w.addMessage('one', ['unknown.example.test']);
  const folded = raw.replace(/b=([A-Za-z0-9+/]{40})/, 'b=$1\r\n\t');
  w.messages.get('one').raw = Buffer.from(folded).toString('base64url');
  await w.getPage();
  const client = await fileClient(w, folded);
  assert.equal(client.state.error, null);
  assert.equal(w.rows.length, 1);
  assert.equal(client.state.logs[0].signatureStatus, 'duplicate');
});

test('chunked oversized evidence is cancelled before parsing or storage', async () => {
  const w = createWorld();
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(4000)));
      controller.enqueue(new TextEncoder().encode(' '.repeat(5000)));
      controller.enqueue(new TextEncoder().encode('never parsed'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://archive.zk.email/api/email', {
    method: 'POST',
    body,
    duplex: 'half',
  });
  assert.equal(request.headers.get('content-length'), null);
  assert.equal((await w.postEmail(request)).status, 400);
  assert.equal(cancelled, true);
  assert.equal(w.rows.length, 0);
  assert.equal(w.queueCalls.length, 0);
});

test(';bh= in Subject and unrelated headers cannot replace DKIM evidence', async () => {
  for (const subject of ['private;bh=fake', 'private;bh=\r\n\tfake']) {
    const w = createWorld();
    const raw = w
      .rawEmail(['unknown.example.test'], subject)
      .replace(
        '\r\n\r\nfixture body',
        '\r\nX-Unrelated: text;bh=unrelated\r\n\r\nfixture body'
      );
    const client = await fileClient(w, raw);
    assert.equal(client.state.error, null);
    assert.equal(w.rows.length, 1);
    w.assertValidStored(w.rows[0]);
  }
});
