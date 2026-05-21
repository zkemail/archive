'use client';

import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useState } from 'react';

interface JWK {
  kty: string;
  alg: string;
  e: string;
  n: string;
  kid: string;
  use: string;
}

interface JWKSRecord {
  id: number;
  x509Certificate: string; // JSON string
  jwks: string; // JSON string
  lastUpdated: string;
}

interface CollapsibleItemProps {
  title: string;
  content: string;
  defaultOpen?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className='absolute top-3 right-3 rounded p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700'
      title='Copy to clipboard'
    >
      {copied ? (
        <Check className='h-4 w-4 text-green-500' />
      ) : (
        <Copy className='h-4 w-4 text-gray-500' />
      )}
    </button>
  );
}

function CollapsibleItem({
  title,
  content,
  defaultOpen = false,
}: CollapsibleItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className='overflow-hidden rounded-lg border border-border'>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='hover:bg-muted/50 flex w-full items-center justify-between bg-foreground px-4 py-3 text-left transition-colors'
      >
        <span className='truncate pr-4 font-mono text-sm'>{title}</span>
        {isOpen ? (
          <ChevronUp className='text-muted-foreground h-5 w-5 flex-shrink-0' />
        ) : (
          <ChevronDown className='text-muted-foreground h-5 w-5 flex-shrink-0' />
        )}
      </button>
      {isOpen && (
        <div className='relative border-t border-border bg-background'>
          <CopyButton text={content} />
          <pre className='max-h-[300px] overflow-x-auto overflow-y-auto p-4 pr-12 font-mono text-xs whitespace-pre'>
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  children: React.ReactNode;
}

function Row({ label, children }: RowProps) {
  return (
    <div className='flex flex-col gap-2 border-b border-border py-4 last:border-b-0 sm:flex-row sm:gap-8'>
      <div className='flex-shrink-0 sm:w-40'>
        <span className='text-muted-foreground text-sm font-medium'>
          {label}
        </span>
      </div>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function JWKSViewer({ record }: { record: JWKSRecord }) {
  // Parse the JSON strings
  const x509Certs: Record<string, string> = JSON.parse(record.x509Certificate);
  const jwks: { keys: JWK[] } = JSON.parse(record.jwks);

  const certEntries = Object.entries(x509Certs);

  return (
    <div className='mb-3 w-full rounded border border-border px-4'>
      {/* ID Row */}
      <Row label='ID'>
        <span className='text-sm'>{record.id}</span>
      </Row>

      {/* X509 Certificates */}
      <Row label='X509 Certificates'>
        <div className='flex flex-col gap-2'>
          {certEntries.map(([kid, cert], index) => (
            <CollapsibleItem
              key={kid}
              title={kid}
              content={cert}
              defaultOpen={index === 0}
            />
          ))}
        </div>
      </Row>

      {/* Key IDs */}
      <Row label='Key IDs'>
        <div className='flex flex-col gap-2'>
          {jwks.keys.map((key, index) => (
            <CollapsibleItem
              key={key.kid}
              title={key.kid}
              content={JSON.stringify({ keys: [key] }, null, 2)}
              defaultOpen={index === 0}
            />
          ))}
        </div>
      </Row>

      {/* Last Updated */}
      <Row label='Last Updated'>
        <span className='text-sm'>{formatDate(record.lastUpdated)}</span>
      </Row>
    </div>
  );
}

export type { JWK, JWKSRecord };
