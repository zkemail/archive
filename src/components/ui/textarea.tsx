import { Label } from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  title?: string;
  errorMessage?: string;
  helpText?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, errorMessage, helpText, ...props }, ref) => {
    return (
      <div className='flex flex-col gap-2'>
        {props.title ? (
          <Label className='text-grey-900 text-base' htmlFor={props.title}>
            {props.title}
          </Label>
        ) : null}
        <textarea
          className={cn(
            'border-input placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          ref={ref}
          {...props}
        />
        {errorMessage || helpText ? (
          <p
            className={cn(
              'text-grey-600 text-base',
              errorMessage ? 'text-red-500' : ''
            )}
          >
            {errorMessage || helpText}
          </p>
        ) : null}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
