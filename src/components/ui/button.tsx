import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none lg:focus-visible:ring-1 lg:focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-background border-2 rounded-xl border-ring shadow',
        destructive:
          'flex flex-row gap-0.5 rounded-lg border border-red-300 bg-red-100 px-2 py-1 text-red-500 hover:bg-destructive/10',
        outline:
          'border border-input rounded-lg hover:bg-accent hover:text-accent-foreground',
        tag: 'bg-white',
        secondary:
          'bg-neutral-200 rounded border text-grey-800 rounded-lg border-grey-500 font-medium shadow-sm hover:bg-secondary/100',
        ghost: '',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'px-7 py-3 h-10 text-base font-bold leading-[0.875rem]',
        sm: 'h-8 rounded-lg px-3 text-sm leading-[0.875rem]',
        lg: 'h-10 rounded-lg px-8',
        icon: 'h-9 w-9',
        smIcon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      onClick,
      startIcon,
      endIcon,
      variant,
      loading,
      size,
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={onClick}
        disabled={loading}
        ref={ref}
        {...props}
      >
        {loading ? (
          <span className='mr-2 w-max'>
            <Loader2 className='h-4 w-4 animate-spin' />
          </span>
        ) : startIcon ? (
          <span className='mr-2 w-max'>{startIcon}</span>
        ) : null}
        {children}
        {endIcon && <span className='ml-2 w-max'>{endIcon}</span>}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
