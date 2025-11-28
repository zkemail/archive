'use client';

import { CopyButton } from './copy-button';

interface CodeBlockProps {
  code: string;
  title?: string;
  className?: string;
}

export function CodeBlock({ code, title, className }: CodeBlockProps) {
  return (
    <div className={className}>
      {title && (
        <div className='mb-2 text-xs font-semibold tracking-wide text-secondary uppercase'>
          {title}
        </div>
      )}
      <div className='relative rounded-lg border border-border bg-background p-4'>
        <div className='absolute top-3 right-3'>
          <CopyButton text={code} />
        </div>
        <pre className='overflow-x-auto pr-8 text-sm text-secondary'>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
