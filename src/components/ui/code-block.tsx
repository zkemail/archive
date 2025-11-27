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
        <div className='text-secondary mb-2 text-xs font-semibold tracking-wide uppercase'>
          {title}
        </div>
      )}
      <div className='bg-background border-border relative rounded-lg border p-4'>
        <div className='absolute top-3 right-3'>
          <CopyButton text={code} />
        </div>
        <pre className='text-secondary overflow-x-auto pr-8 text-sm'>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
