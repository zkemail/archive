'use client';

import Image from 'next/image';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { analytics } from '@/lib/analytics';

interface DkimKey {
  domain: string;
  selector: string;
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export default function ApiDocsPage() {
  const [domainInput, setDomainInput] = useState('amazon.com');
  const [apiResults, setApiResults] = useState<DkimKey[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exampleResponse = `[
  {
    "id": 4711,
    "value": "string",
    "domain": "string",
    "selector": "string",
    "lastSeenAt": "2025-06-25T13:03:56.862Z",
    "firstSeenAt": "2025-06-25T13:03:56.862Z",
    "observations": [
      {
        "source": "live_dns",
        "firstSeenAt": "2025-06-25T13:03:56.862Z",
        "lastSeenAt": "2025-06-25T13:03:56.862Z"
      }
    ]
  }
]`;

  const dkimKeysSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        value: { type: 'string' },
        domain: { type: 'string' },
        selector: { type: 'string' },
        lastSeenAt: { type: 'string', format: 'date-time' },
        firstSeenAt: { type: 'string', format: 'date-time' },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['live_dns', 'gcd_recovered'] },
              firstSeenAt: { type: 'string', format: 'date-time' },
              lastSeenAt: { type: 'string', format: 'date-time' },
            },
            required: ['source', 'firstSeenAt', 'lastSeenAt'],
          },
        },
      },
      required: [
        'value',
        'domain',
        'selector',
        'lastSeenAt',
        'firstSeenAt',
        'observations',
      ],
    },
  };

  const statementExample = `[
  "eyJhbGciOiJFZERTQSIsImtpZCI6ImFyY2hpdmUtc3RhdGVtZW50LTIwMjYtMDgtMTIifQ..."
]`;

  const statementPayloadExample = `{
  "v": 1,
  "iss": "archive.zk.email",
  "iat": 1789000000,
  "record": {
    "id": "4711",
    "domain": "example.com",
    "selector": "mail2026",
    "value": "v=DKIM1; k=rsa; p=MIIB...",
    "source": "live_dns",
    "first_seen_at": "2026-06-01T00:00:00.000Z",
    "last_seen_at": "2026-07-15T08:00:00.000Z"
  }
}`;

  const dkimKeysSchemaString = JSON.stringify(dkimKeysSchema, null, 2);

  const handleSearchKeys = async () => {
    if (!domainInput.trim()) {
      setError('Please enter a domain');
      return;
    }

    analytics.capture('api_test', { domain: domainInput });
    setIsLoading(true);
    setError(null);
    setApiResults(null);

    try {
      const response = await fetch(
        `https://archive.zk.email/api/key?domain=${encodeURIComponent(domainInput)}`
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setApiResults(data);
      analytics.capture('api_test_success', {
        domain: domainInput,
        resultCount: data.length,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch keys';
      setError(errorMessage);
      analytics.capture('api_test_error', {
        domain: domainInput,
        error: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className='my-8 flex flex-col items-center justify-center'>
      {/* Hero Section */}
      <div className='relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border border-border md:aspect-9/2'>
        <div className='absolute bottom-0 z-40 inline-flex flex-col items-start justify-start p-6'>
          <div className='flex justify-start text-[clamp(2rem,3.34vw,3rem)] font-bold text-white capitalize'>
            DKIM Archive API
          </div>
          <div className='flex justify-start text-[clamp(1rem,1.39vw,1.25rem)] leading-5 font-semibold tracking-tight text-white'>
            <span className='whitespace-normal'>
              Specification for DKIM Archive API, which follows OpenAPI 3.0.3
              specs.
            </span>
          </div>
        </div>
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-gradient-to-b from-sky-900/0 to-sky-900/90 blur-[2px] md:h-20'></div>
        <Image
          src='/header-api.png'
          alt='API Documentation header image'
          fill={true}
          className='object-cover'
        />
      </div>

      {/* Content Section */}
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        {/* API Reference Section */}
        <div className='flex w-full flex-col gap-4'>
          <h2 className='text-lg font-semibold text-secondary'>
            API Reference
          </h2>
          <p className='text-sm leading-relaxed text-secondary'>
            This is the API specification for the DKIM Archive API, which
            processes Gmail messages for DKIM signatures and provides -
          </p>
          <ol className='ml-4 flex list-decimal flex-col gap-2 text-sm text-secondary'>
            <li>
              Endpoints to{' '}
              <strong className='text-secondary'>query archived keys</strong>
            </li>
            <li>
              <strong className='text-secondary'>
                Add domain-selector pairs
              </strong>
              , and
            </li>
            {/* <li>
              Periodically{' '}
              <strong className='text-secondary'>refresh DNS records</strong>
            </li> */}
          </ol>
        </div>

        {/* Base URL Section */}
        <div className='flex w-full flex-col gap-3 rounded-lg bg-background p-4'>
          <div className='text-xs font-semibold tracking-wider text-secondary uppercase'>
            BASE URL
          </div>
          <div className='h-px w-full border-border bg-border'></div>
          <div className='flex items-center justify-between'>
            <code className='font-mono text-sm text-secondary'>
              https://archive.zk.email/api
            </code>
            <CopyButton text='https://archive.zk.email/api' />
          </div>
        </div>
        <div className='h-px w-full border-border bg-border'></div>

        {/* List-keys Endpoint */}
        <div className='flex w-full flex-col gap-4'>
          <h3 className='text-base font-semibold text-secondary'>List-keys</h3>

          {/* Endpoint Header */}
          <div className='flex w-full flex-col gap-3 rounded-lg bg-background p-2'>
            <div className='flex items-center gap-2'>
              <Badge variant='api'>GET</Badge>
              <code className='font-mono text-sm text-secondary'>/api</code>
            </div>
          </div>

          <p className='text-sm text-secondary'>
            Returns a list of DKIM keys for a given domain and its subdomains.
          </p>

          {/* Parameters Section */}
          <div className='flex flex-col gap-3'>
            <h4 className='text-sm font-semibold text-primary'>Parameters</h4>
            <div className='flex flex-col gap-2 px-4'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium text-primary'>domain</span>
                <span className='text-sm text-accent-foreground-green'>
                  string
                </span>
                (query)
                <Badge variant='api'>REQUIRED</Badge>
              </div>
              <div className='px-2'>
                <p className='text-sm text-secondary'>
                  Output the domain name and/or any matching subdomains
                </p>
              </div>
            </div>
          </div>

          {/* Try It Out Section */}
          <div className='flex flex-col gap-3 rounded-lg border-0 bg-background p-4'>
            <div className='text-xs font-semibold tracking-wide text-secondary uppercase'>
              TRY IT OUT
            </div>
            <div className='flex flex-col gap-2'>
              <label className='text-sm font-medium text-primary'>Domain</label>
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder='amazon.com'
                className='text-secondary'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchKeys();
                  }
                }}
              />
            </div>

            {/* API Results Display */}
            {isLoading && (
              <div className='flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border border-border p-4'>
                <div className='text-sm text-secondary'>Loading...</div>
              </div>
            )}

            {error && (
              <div className='flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border border-border p-4'>
                <div className='text-sm text-red-500'>{error}</div>
              </div>
            )}

            {apiResults && apiResults.length > 0 && (
              <div className='h-[400px] w-full overflow-auto rounded-lg border border-border bg-background'>
                <pre className='p-4 font-mono text-sm text-secondary'>
                  {JSON.stringify(apiResults, null, 2)}
                </pre>
              </div>
            )}

            {apiResults && apiResults.length === 0 && (
              <div className='flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border border-border p-4'>
                <div className='text-sm text-secondary'>
                  No keys found for this domain
                </div>
              </div>
            )}

            <Button
              onClick={handleSearchKeys}
              className='w-fit'
              disabled={isLoading}
            >
              {isLoading ? 'Searching...' : 'Search keys'}
            </Button>
          </div>

          {/* Responses Section */}
          <div className='flex flex-col gap-4'>
            <h4 className='text-sm font-semibold text-primary'>Responses</h4>

            {/* 200 Success Response */}
            <div className='flex flex-col gap-3'>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>200</Badge>
                <span className='text-sm text-secondary'>
                  Successful operation
                </span>
              </div>
              <div className='ml-8'>
                <div className='text-xs text-secondary'>
                  Media type:{' '}
                  <code className='text-primary'>application/json</code>
                </div>

                {/* Example Value */}
                <CodeBlock code={exampleResponse} title='EXAMPLE VALUE' />

                {/* Schema Section */}
                <div className='flex flex-col gap-3'>
                  <div className='text-xs font-semibold tracking-wide text-secondary uppercase'>
                    SCHEMA
                  </div>
                  <div className='relative rounded-lg border border-border bg-background p-4'>
                    <div className='absolute top-3 right-3'>
                      <CopyButton text={dkimKeysSchemaString} />
                    </div>
                    <div className='font-mono text-sm'>
                      <div className='mb-2 font-semibold text-secondary'>
                        DkimKeys
                      </div>
                      <div className='ml-4 flex flex-col gap-1'>
                        <div className='text-secondary'>
                          <span className='text-secondary'>Items</span>{' '}
                          <span className='text-accent-foreground-purple'>
                            object
                          </span>
                        </div>
                        <div className='ml-4 flex flex-col gap-1'>
                          <div className='text-secondary'>
                            <span className='text-secondary'>value*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                          </div>
                          <div className='text-secondary'>
                            <span className='text-secondary'>domain*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                          </div>
                          <div className='text-secondary'>
                            <span className='text-secondary'>selector*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                          </div>
                          <div className='flex items-center gap-2 text-secondary'>
                            <span className='text-secondary'>lastSeenAt*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                            <span className='text-xs text-secondary'>
                              date-time
                            </span>
                          </div>
                          <div className='flex items-center gap-2 text-secondary'>
                            <span className='text-secondary'>firstSeenAt*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                            <span className='text-xs text-secondary'>
                              date-time
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Error Responses */}
            <div className='flex flex-col gap-4'>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>400</Badge>
                <span className='text-sm text-secondary'>
                  Missing or invalid parameter
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>429</Badge>
                <span className='text-sm text-secondary'>
                  Rate limit exceeded
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>500</Badge>
                <span className='text-sm text-secondary'>Unexpected error</span>
              </div>
            </div>
          </div>

          <div className='h-px w-full border-border bg-border'></div>

          {/* Signed-statement Endpoint */}
          <div className='flex w-full flex-col gap-4'>
            <h3 className='text-base font-semibold text-secondary'>
              Signed observation statements
            </h3>

            <div className='flex w-full flex-col gap-3 rounded-lg bg-background p-2'>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>GET</Badge>
                <code className='font-mono text-sm text-secondary'>
                  /api/key/statement
                </code>
              </div>
            </div>

            <p className='text-sm text-secondary'>
              Returns signed, offline-verifiable statements for one domain and
              selector, as a JSON array of compact JWS strings. Embed them in
              your own evidence and re-verify them later without calling this
              service.
            </p>

            <p className='text-sm text-secondary'>
              One statement is issued per stored key value per signable
              observation channel, each carrying the{' '}
              <code className='text-primary'>source</code> it came from. Bound
              key validity on the channel you trust rather than on a blended
              window.
            </p>

            <p className='text-sm text-secondary'>
              Only <code className='text-primary'>live_dns</code> is signed
              today. <code className='text-primary'>gcd_recovered</code>{' '}
              observations stay unsigned until their ingest path meets the same
              trust bar, so a key known only from a submitted email yields an
              empty array here while still appearing in{' '}
              <code className='text-primary'>/api/key</code>.
            </p>

            {/* Parameters Section */}
            <div className='flex flex-col gap-3'>
              <h4 className='text-sm font-semibold text-primary'>Parameters</h4>
              <div className='flex flex-col gap-2 px-4'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium text-primary'>
                    domain
                  </span>
                  <span className='text-sm text-accent-foreground-green'>
                    string
                  </span>
                  (query)
                  <Badge variant='api'>REQUIRED</Badge>
                </div>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium text-primary'>
                    selector
                  </span>
                  <span className='text-sm text-accent-foreground-green'>
                    string
                  </span>
                  (query)
                  <Badge variant='api'>REQUIRED</Badge>
                </div>
              </div>
            </div>

            {/* Responses Section */}
            <div className='flex flex-col gap-4'>
              <h4 className='text-sm font-semibold text-primary'>Responses</h4>

              <div className='flex flex-col gap-3'>
                <div className='flex items-center gap-2'>
                  <Badge variant='api'>200</Badge>
                  <span className='text-sm text-secondary'>
                    Successful operation
                  </span>
                </div>
                <div className='ml-8 flex flex-col gap-3'>
                  <CodeBlock code={statementExample} title='EXAMPLE VALUE' />
                  <div className='text-xs text-secondary'>
                    Decoded JWS payload:
                  </div>
                  <CodeBlock
                    code={statementPayloadExample}
                    title='STATEMENT PAYLOAD'
                  />
                </div>
              </div>

              <div className='flex items-center gap-2'>
                <Badge variant='api'>400</Badge>
                <span className='text-sm text-secondary'>
                  Missing or invalid parameter
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>429</Badge>
                <span className='text-sm text-secondary'>
                  Rate limit exceeded
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>503</Badge>
                <span className='text-sm text-secondary'>
                  Statement signing is not configured on this deployment
                </span>
              </div>
            </div>
          </div>

          <div className='h-px w-full border-border bg-border'></div>

          {/* Verification keys */}
          <div className='flex w-full flex-col gap-4'>
            <h3 className='text-base font-semibold text-secondary'>
              Statement verification keys
            </h3>

            <div className='flex w-full flex-col gap-3 rounded-lg bg-background p-2'>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>GET</Badge>
                <code className='font-mono text-sm text-secondary'>
                  /.well-known/dkim-archive-jwks.json
                </code>
              </div>
            </div>

            <p className='text-sm text-secondary'>
              The public keys statements are verified against, as a JWKS. Any
              stock JOSE library can use it. Resolve the key by the{' '}
              <code className='text-primary'>kid</code> in the JWS header, and
              accept only <code className='text-primary'>EdDSA</code> or{' '}
              <code className='text-primary'>ES256</code>.
            </p>

            <p className='text-sm text-secondary'>
              The set is append-only: rotation adds a key and never removes one,
              so statements signed by a retired key stay verifiable. It is also
              mirrored in the repository, so you can pin it instead of fetching
              it at verification time.
            </p>

            <div className='flex items-center justify-between rounded-lg bg-background p-4'>
              <p className='flex-1 text-sm text-secondary'>
                Full format specification, provenance semantics, and freshness
                guarantees.
              </p>
              <Button
                variant='default'
                size='sm'
                className='bg-primary text-background'
                onClick={() =>
                  window.open(
                    'https://github.com/zkemail/archive/blob/main/docs/signed-observations.md',
                    '_blank'
                  )
                }
              >
                Read the spec
              </Button>
            </div>
          </div>

          {/* Rate Limit Notice */}
          <div className='flex items-center justify-between rounded-lg bg-background p-4'>
            <p className='flex-1 text-sm text-secondary'>
              Limit reached? Reach out to our team to enhance your rate limit.
            </p>
            <Button
              variant='default'
              size='sm'
              className='flex items-center gap-2 bg-primary text-background'
              onClick={() => window.open('https://t.me/zkemail', '_blank')}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 16 16'
                fill='currentColor'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path d='M14.5 1.5L1 7l4 1.5L12 4l-4.5 5.5L11 13l3.5-11.5z' />
              </svg>
              Telegram
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
