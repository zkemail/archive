'use client';

import { MoonIcon, SunDimIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import React, { useCallback } from 'react';

import { Button } from './ui/button';

interface ThemeToggleProps {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  mounted: boolean;
}

const ThemeToggle = ({ theme, setTheme, mounted }: ThemeToggleProps) => {
  const handleLightTheme = useCallback(() => setTheme('light'), [setTheme]);
  const handleDarkTheme = useCallback(() => setTheme('dark'), [setTheme]);

  if (!mounted) return null;

  return (
    <div className='border-input relative flex gap-2 rounded-xl border p-1'>
      <motion.div
        className='bg-background border-input absolute size-8 rounded-lg border shadow-sm'
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
          color='#3B3B3B'
          weight={theme === 'light' ? 'fill' : 'regular'}
          className='transition-all'
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
          color={theme === 'dark' ? '#D4D4D4' : '#A8A8A8'}
          weight={theme === 'dark' ? 'fill' : 'regular'}
          className='transition-all'
        />
      </Button>
    </div>
  );
};

export default ThemeToggle;
