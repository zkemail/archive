'use client';

import Image from 'next/image';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';

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
    "value": "string",
    "domain": "string",
    "selector": "string",
    "lastSeenAt": "2025-06-25T13:03:56.862Z",
    "firstSeenAt": "2025-06-25T13:03:56.862Z"
  }
]`;

  const handleSearchKeys = async () => {
    if (!domainInput.trim()) {
      setError('Please enter a domain');
      return;
    }

    setIsLoading(true);
    setError(null);
    setApiResults(null);

    try {
      const response = await fetch(
        `https://archive.prove.email/api/key?domain=${encodeURIComponent(domainInput)}`
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setApiResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch keys');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className='my-8 flex flex-col items-center justify-center'>
      {/* Hero Section */}
      <div className='border-border relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border md:aspect-9/2'>
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
      <div className='bg-foreground border-border flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l p-6'>
        {/* API Reference Section */}
        <div className='flex w-full flex-col gap-4'>
          <h2 className='text-secondary text-lg font-semibold'>
            API Reference
          </h2>
          <p className='text-secondary text-sm leading-relaxed'>
            This is the API specification for the DKIM Archive API, which
            processes Gmail messages for DKIM signatures and provides -
          </p>
          <ol className='text-secondary ml-4 flex list-decimal flex-col gap-2 text-sm'>
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
        <div className='bg-background flex w-full flex-col gap-3 rounded-lg p-4'>
          <div className='text-secondary text-xs font-semibold tracking-wider uppercase'>
            BASE URL
          </div>
          <div className='border-border bg-border h-px w-full'></div>
          <div className='flex items-center justify-between'>
            <code className='text-secondary font-mono text-sm'>
              https://archive.prove.email/api
            </code>
            <CopyButton text='https://archive.prove.email/api' />
          </div>
        </div>
        <div className='border-border bg-border h-px w-full'></div>

        {/* List-keys Endpoint */}
        <div className='flex w-full flex-col gap-4'>
          <h3 className='text-secondary text-base font-semibold'>List-keys</h3>

          {/* Endpoint Header */}
          <div className='bg-background flex w-full flex-col gap-3 rounded-lg p-2'>
            <div className='flex items-center gap-2'>
              <Badge variant='api'>GET</Badge>
              <code className='text-secondary font-mono text-sm'>/api</code>
            </div>
          </div>

          <p className='text-secondary text-sm'>
            Returns a list of DKIM keys for a given domain and its subdomains.
          </p>

          {/* Parameters Section */}
          <div className='flex flex-col gap-3'>
            <h4 className='text-primary text-sm font-semibold'>Parameters</h4>
            <div className='flex flex-col gap-2 px-4'>
              <div className='flex items-center gap-2'>
                <span className='text-primary text-sm font-medium'>domain</span>
                <span className='text-accent-foreground-green text-sm'>
                  string
                </span>
                (query)
                <Badge variant='api'>REQUIRED</Badge>
              </div>
              <div className='px-2'>
                <p className='text-secondary text-sm'>
                  Output the domain name and/or any matching subdomains
                </p>
              </div>
            </div>
          </div>

          {/* Try It Out Section */}
          <div className='bg-background flex flex-col gap-3 rounded-lg border-0 p-4'>
            <div className='text-secondary text-xs font-semibold tracking-wide uppercase'>
              TRY IT OUT
            </div>
            <div className='flex flex-col gap-2'>
              <label className='text-primary text-sm font-medium'>Domain</label>
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
              <div className='border-border flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border p-4'>
                <div className='text-secondary text-sm'>Loading...</div>
              </div>
            )}

            {error && (
              <div className='border-border flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border p-4'>
                <div className='text-sm text-red-500'>{error}</div>
              </div>
            )}

            {apiResults && apiResults.length > 0 && (
              <div className='border-border bg-background h-[400px] w-full overflow-auto rounded-lg border'>
                <pre className='text-secondary p-4 font-mono text-sm'>
                  {JSON.stringify(apiResults, null, 2)}
                </pre>
              </div>
            )}

            {apiResults && apiResults.length === 0 && (
              <div className='border-border flex h-[400px] w-full items-center justify-center overflow-auto rounded-lg border p-4'>
                <div className='text-secondary text-sm'>
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
            <h4 className='text-primary text-sm font-semibold'>Responses</h4>

            {/* 200 Success Response */}
            <div className='flex flex-col gap-3'>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>200</Badge>
                <span className='text-secondary text-sm'>
                  Successful operation
                </span>
              </div>
              <div className='ml-8'>
                <div className='text-secondary text-xs'>
                  Media type:{' '}
                  <code className='text-primary'>application/json</code>
                </div>

                {/* Example Value */}
                <CodeBlock code={exampleResponse} title='EXAMPLE VALUE' />

                {/* Schema Section */}
                <div className='flex flex-col gap-3'>
                  <div className='text-secondary text-xs font-semibold tracking-wide uppercase'>
                    SCHEMA
                  </div>
                  <div className='bg-background border-border relative rounded-lg border p-4'>
                    <div className='absolute top-3 right-3'>
                      <CopyButton text='DkimKeys schema' />
                    </div>
                    <div className='font-mono text-sm'>
                      <div className='text-secondary mb-2 font-semibold'>
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
                          <div className='text-secondary flex items-center gap-2'>
                            <span className='text-secondary'>lastSeenAt*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                            <span className='text-secondary text-xs'>
                              date-time
                            </span>
                          </div>
                          <div className='text-secondary flex items-center gap-2'>
                            <span className='text-secondary'>firstSeenAt*</span>{' '}
                            <span className='text-accent-foreground-purple'>
                              string
                            </span>
                            <span className='text-secondary text-xs'>
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
                <span className='text-secondary text-sm'>
                  Missing or invalid parameter
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>408</Badge>
                <span className='text-secondary text-sm'>
                  Rate limit exceeded
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant='api'>500</Badge>
                <span className='text-secondary text-sm'>Unexpected error</span>
              </div>
            </div>
          </div>

          {/* Rate Limit Notice */}
          <div className='bg-background flex items-center justify-between rounded-lg p-4'>
            <p className='text-secondary flex-1 text-sm'>
              Limit reached? Reach out to our team to enhance your rate limit.
            </p>
            <Button
              variant='default'
              size='sm'
              className='bg-primary text-background flex items-center gap-2'
              onClick={() =>
                window.open('https://t.me/your-telegram', '_blank')
              }
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
