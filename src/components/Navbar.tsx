'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import React, { useEffect, useState } from 'react';

import { HamburgerMenu, MenuItem } from './HamburgerMenu';
import ThemeToggle from './ThemeToggle';
import { Button } from './ui/button';

const MENU_ITEMS: MenuItem[] = [
  { name: 'JWT Directory', to: '/jwt' },
  { name: 'Explore API', to: '/api-docs' },
  { name: 'About Us', to: 'https://archive.zk.email/about' },
];

const Navbar = () => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <nav
      role='navigation'
      aria-label='Main navigation'
      className='transition-theme z-150 flex flex-row items-center justify-between border-b border-border bg-foreground px-4 md:px-6'
    >
      <Link href='/'>
        <div className='my-3.5 md:my-4 lg:my-[22px]'>
          <Image
            src='/archive-logo-light.svg'
            alt='Archive'
            width={107}
            height={24}
            className='object-contain dark:hidden'
            priority
          />
          <Image
            src='/archive-logo-dark.svg'
            alt='Archive'
            width={107}
            height={24}
            className='hidden object-contain dark:block'
            priority
          />
        </div>
      </Link>

      {/* Desktop Navigation */}
      <div className='hidden flex-row items-center justify-between gap-4 md:flex'>
        <ThemeToggle theme={theme} setTheme={setTheme} mounted={mounted} />
        <Link href={'/contribute'}>
          <Button
            className='transition-theme hover:scale-102 active:scale-98'
            aria-label='Contribute to the archive'
          >
            Contribute
          </Button>
        </Link>
      </div>

      {/* Mobile Navigation */}
      <div className='flex items-center gap-2 md:hidden'>
        <HamburgerMenu
          theme={theme}
          setTheme={setTheme}
          mounted={mounted}
          items={MENU_ITEMS}
        />
      </div>
    </nav>
  );
};

export default Navbar;
