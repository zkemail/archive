import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none',
  {
    variants: {
      variant: {
        default:
          'text-primary-foreground border-transparent bg-primary hover:bg-primary/80',
        secondary:
          'text-secondary-foreground border-transparent bg-secondary hover:bg-secondary/80',
        destructive:
          'text-destructive-foreground border-transparent bg-destructive hover:bg-destructive/80',
        outline: 'text-foreground',
        active:
          'gap-2 overflow-hidden rounded border-0 bg-accent-background-green px-2 py-0.5 text-xs leading-none font-normal tracking-tight text-accent-foreground-green',
        expired:
          'gap-2 overflow-hidden rounded border-0 bg-accent-background-red px-2 py-0.5 text-xs leading-none font-normal tracking-tight text-accent-foreground-red',
        updated:
          'gap-2 overflow-hidden rounded border-0 bg-accent-background-purple px-2 py-0.5 text-xs leading-none font-normal tracking-tight text-accent-foreground-purple',
        present:
          'gap-2 overflow-hidden rounded border-0 bg-background px-2 py-0.5 text-xs leading-none font-normal tracking-tight text-secondary',
        source:
          'inline-flex flex-row items-center justify-around gap-1 overflow-hidden rounded border-0 bg-[#FCFCFC] px-1.5 text-xs leading-none font-normal tracking-tight text-secondary dark:bg-[#272727]',
        api: 'rounded border-0 bg-icon-muted p-1 text-xs leading-none font-semibold tracking-tight text-secondary uppercase',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
