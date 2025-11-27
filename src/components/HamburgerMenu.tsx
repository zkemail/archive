import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import ThemeToggle from './ThemeToggle';

export type MenuItem = {
  name: string;
  to: string;
};

interface HamburgerMenuProps {
  theme: string | undefined;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  mounted: boolean;
  items: MenuItem[];
}

export function HamburgerMenu({
  theme,
  setTheme,
  mounted,
  items,
}: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='group flex flex-col items-center justify-center'
          >
            <div
              className={`my-0.75 h-0.5 w-6 rounded bg-primary transition-transform ${
                isOpen
                  ? 'translate-y-2 rotate-45 group-hover:opacity-100'
                  : 'group-hover:opacity-100'
              }`}
            />
            <div
              className={`my-0.75 h-0.5 w-6 rounded bg-primary transition-transform ${
                isOpen ? 'opacity-0' : 'group-hover:opacity-100'
              }`}
            />
            <div
              className={`my-0.75 h-0.5 w-6 rounded bg-primary transition-transform ${
                isOpen
                  ? '-translate-y-2 -rotate-45 group-hover:opacity-100'
                  : 'group-hover:opacity-100'
              }`}
            />
            <span className='sr-only'>Toggle navigation menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='center'
          className='w-screen bg-foreground !duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-48 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-48'
        >
          {items.map((item) => (
            <DropdownMenuItem key={item.to} asChild>
              <Link
                href={item.to}
                className='w-full cursor-pointer text-ring [&.active]:text-input'
              >
                {item.name}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
            <div className='flex flex-row items-center justify-between'>
              <Button>Contribute</Button>
              <ThemeToggle
                theme={theme}
                setTheme={setTheme}
                mounted={mounted}
              />
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
