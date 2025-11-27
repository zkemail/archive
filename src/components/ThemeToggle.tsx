'use client';

import { MoonIcon, SunDimIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import React, { useCallback } from 'react';

import { Button } from './ui/button';

interface ThemeToggleProps {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  mounted: boolean;
}

const ThemeToggle = ({ theme, setTheme, mounted }: ThemeToggleProps) => {
  const handleLightTheme = useCallback(() => setTheme('light'), [setTheme]);
  const handleDarkTheme = useCallback(() => setTheme('dark'), [setTheme]);

  if (!mounted) return null;

  return (
    <div className='relative flex gap-2 rounded-xl border border-input p-1'>
      <motion.div
        className='absolute size-8 rounded-lg border border-input bg-background shadow-sm'
        layout
        initial={false}
        animate={{ x: theme === 'dark' ? 40 : 0 }}
        transition={{
          type: 'spring',
          duration: 0.25,
          bounce: 0.3,
        }}
      />
      <Button
        variant='ghost'
        size='smIcon'
        onClick={handleLightTheme}
        aria-label='Switch to light theme'
        aria-pressed={theme === 'light'}
        className='transition-theme relative z-10 rounded-lg'
      >
        <SunDimIcon
          size={24}
          color='currentColor'
          weight={theme === 'light' ? 'fill' : 'regular'}
          className='text-icon-sun transition-all'
        />
      </Button>
      <Button
        variant='ghost'
        size='smIcon'
        onClick={handleDarkTheme}
        aria-label='Switch to dark theme'
        aria-pressed={theme === 'dark'}
        className='transition-theme relative z-10 rounded-lg'
      >
        <MoonIcon
          size={24}
          color='currentColor'
          weight={theme === 'dark' ? 'fill' : 'regular'}
          className='text-icon-moon transition-all'
        />
      </Button>
    </div>
  );
};

export default ThemeToggle;
