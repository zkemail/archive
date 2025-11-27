import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground  hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground  hover:bg-destructive/80',
        outline: 'text-foreground',
        active:
          'rounded border-0 px-2 py-0.5 gap-2  overflow-hidden text-xs font-normal leading-none tracking-tight bg-accent-background-green text-accent-foreground-green',
        expired:
          'rounded border-0 px-2 py-0.5 gap-2  overflow-hidden text-xs font-normal leading-none tracking-tight bg-accent-background-red text-accent-foreground-red',
        updated:
          'bg-accent-background-purple  text-accent-foreground-purple gap-2 overflow-hidden rounded border-0 px-2 py-0.5 text-xs leading-none font-normal tracking-tight',
        present:
          'bg-background text-secondary  gap-2 overflow-hidden rounded border-0 px-2 py-0.5 text-xs leading-none font-normal tracking-tight',
        source:
          'bg-[#FCFCFC] dark:bg-[#272727] text-secondary gap-1 overflow-hidden rounded border-0 px-1.5 text-xs leading-none font-normal tracking-tight inline-flex flex-row justify-around items-center ',
        api: 'bg-icon-muted text-secondary rounded border-0 p-1 text-xs font-semibold leading-none tracking-tight uppercase',
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
