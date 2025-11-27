'use client';

import { ArrowRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import Image from 'next/image';
import { SetStateAction, useEffect, useState } from 'react';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { Input } from '@/components/ui/input';

export default function Home() {
  const [uniqueDomains, setUniqueDomains] = useState(0);
  const [uniqueSelectors, setUniqueSelectors] = useState(0);
  const [DSP, setDSP] = useState(0);
  const [DKIMkey, setDKIMkey] = useState(0);

  useEffect(() => {
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];
    const intervalIds: ReturnType<typeof setInterval>[] = [];
    let isMounted = true;

    const animateValue = (
      setValue: (value: SetStateAction<number>) => void,
      targetValue: number,
      delay = 0
    ) => {
      const timeoutId = setTimeout(() => {
        if (!isMounted) return;

        let current = 0;
        const increment = targetValue / 5;

        const intervalId = setInterval(() => {
          if (!isMounted) {
            clearInterval(intervalId);
            return;
          }

          current += increment;
          if (current >= targetValue) {
            setValue(targetValue);
            clearInterval(intervalId);
          } else {
            setValue(Math.floor(current));
          }
        }, 25);

        intervalIds.push(intervalId);
      }, delay);

      timeoutIds.push(timeoutId);
    };

    animateValue(setUniqueDomains, 408807, 0);
    animateValue(setUniqueSelectors, 5229, 50);
    animateValue(setDSP, 1020408, 100);
    animateValue(setDKIMkey, 1195387, 150);

    return () => {
      isMounted = false;
      timeoutIds.forEach((id) => clearTimeout(id));
      intervalIds.forEach((id) => clearInterval(id));
    };
  }, []);
  return (
    <main className='my-8 flex flex-col items-center justify-center'>
      <div className='relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border border-border'>
        <div className='absolute bottom-0 z-40 inline-flex flex-col items-start justify-start p-6'>
          <div className='flex justify-start text-[clamp(2rem,3.34vw,3rem)] font-bold text-white capitalize'>
            DKIM Archive
          </div>
          <div className='flex justify-start text-[clamp(1rem,1.39vw,1.25rem)] leading-5 font-semibold tracking-tight text-white'>
            <span className='whitespace-normal'>
              Building the largest open-sourced directory of DKIM pairs.&nbsp;
              <span className='underline'>Read More</span>
            </span>
          </div>
        </div>
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-gradient-to-b from-sky-900/0 to-sky-900/90 blur-[2px]'></div>
        <Image
          src='/header-home.png'
          alt='Home page header image'
          fill={true}
          className='object-cover'
        />
      </div>
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <div className='justify-start self-stretch text-base leading-tight tracking-tight text-primary'>
            Search Domain
          </div>
          <div className='my-0.25 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2'>
            <div
              data-name='MagnifyingGlass'
              className='relative my-0.5 h-4 w-4 overflow-hidden'
            >
              <MagnifyingGlassIcon
                size={16}
                color='var(--secondary)'
                weight='bold'
                className='absolute'
              />
            </div>
            <div className='min-w-0 flex-1'>
              <Input
                placeholder='Domain name'
                size='search'
                className='flex-1 border-0 text-base leading-tight tracking-tight text-secondary outline-0'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const value = e.currentTarget.value.trim();
                    if (value) {
                      window.location.href = `/search?q=${encodeURIComponent(value)}`;
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div className='flex w-full flex-col items-start justify-start gap-3'>
          <div className='justify-start self-stretch leading-tight tracking-tight text-primary'>
            Statistics
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='justify-start leading-tight tracking-tight text-secondary'>
              Unique domains
            </div>
            <div className='justify-end text-right leading-tight text-secondary'>
              <AnimatedNumber value={uniqueDomains} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='justify-start leading-tight tracking-tight text-secondary'>
              Unique selectors
            </div>
            <div className='justify-end text-right leading-tight text-secondary'>
              <AnimatedNumber value={uniqueSelectors} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='justify-start leading-tight tracking-tight text-secondary'>
              Domain/selector-pairs
            </div>
            <div className='justify-end text-right leading-tight text-secondary'>
              <AnimatedNumber value={DSP} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='justify-start leading-tight tracking-tight text-secondary'>
              DKIM keys
            </div>
            <div className='justify-end text-right leading-tight text-secondary'>
              <AnimatedNumber value={DKIMkey} />
            </div>
          </div>
        </div>
        <div className='flex items-center justify-around self-stretch overflow-hidden rounded-lg bg-background px-3 py-2'>
          <div className='flex-1 justify-start leading-tight tracking-tight text-primary'>
            Browse our JWT key directory
          </div>
          <div data-name='ArrowRight' className='relative h-4 w-4'>
            <ArrowRightIcon
              size={16}
              weight='bold'
              className='bg-Grey-900 absolute text-primary'
            />
          </div>
        </div>
      </div>
    </main>
  );
}
