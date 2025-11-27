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
  ({ className, errorMessage, helpText, id, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;

    return (
      <div className='flex flex-col gap-2'>
        {props.title ? (
          <Label className='text-grey-900 text-base' htmlFor={textareaId}>
            {props.title}
          </Label>
        ) : null}
        <textarea
          id={textareaId}
          className={cn(
            'placeholder:text-muted-foreground flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
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
