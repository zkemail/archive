'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import React, { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { HamburgerMenu, MenuItem } from './HamburgerMenu';
import ThemeToggle from './ThemeToggle';

const MENU_ITEMS: MenuItem[] = [
  { name: 'JWT Directory', to: '/jwt' },
  { name: 'Explore API', to: '/api' },
  { name: 'About Us', to: '/contact' },
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
      className='bg-foreground transition-theme border-border flex flex-row items-center justify-between border-b px-4 md:px-6'
    >
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

      {/* Desktop Navigation */}
      <div className='hidden flex-row items-center justify-between gap-4 md:flex'>
        <ThemeToggle theme={theme} setTheme={setTheme} mounted={mounted} />
        <Button
          className='transition-theme hover:scale-102 active:scale-98'
          aria-label='Contribute to the archive'
        >
          Contribute
        </Button>
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
