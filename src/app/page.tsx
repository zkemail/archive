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
    const animateValue = (
      setValue: {
        (value: SetStateAction<number>): void;
        (value: SetStateAction<number>): void;
        (value: SetStateAction<number>): void;
        (value: SetStateAction<number>): void;
        (arg0: number): void;
      },
      targetValue: number,
      delay = 0
    ) => {
      setTimeout(() => {
        let current = 0;
        const increment = targetValue / 5;

        const timer = setInterval(() => {
          current += increment;
          if (current >= targetValue) {
            setValue(targetValue);
            clearInterval(timer);
          } else {
            setValue(Math.floor(current));
          }
        }, 25);
      }, delay);
    };

    animateValue(setUniqueDomains, 408807, 0);
    animateValue(setUniqueSelectors, 5229, 50);
    animateValue(setDSP, 1020408, 100);
    animateValue(setDKIMkey, 1195387, 150);
  }, []);
  return (
    <main className='my-8 flex flex-col items-center justify-center'>
      <div className='border-border relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border'>
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
      <div className='bg-foreground border-border flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l p-6'>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <div className='text-primary justify-start self-stretch text-base leading-tight tracking-tight'>
            Search Domain
          </div>
          <div className='border-border my-0.25 flex w-full items-center gap-2 rounded-lg border px-3 py-2'>
            <div
              data-name='MagnifyingGlass'
              className='relative my-0.5 h-4 w-4 overflow-hidden'
            >
              <MagnifyingGlassIcon
                size={16}
                color='#606060'
                weight='bold'
                className='absolute'
              />
            </div>
            <div className='min-w-0 flex-1'>
              <Input
                placeholder='Domain name'
                size='search'
                className='text-secondary flex-1 border-0 text-base leading-tight tracking-tight outline-0'
              />
            </div>
          </div>
        </div>
        <div className='flex w-full flex-col items-start justify-start gap-3'>
          <div className='text-primary justify-start self-stretch leading-tight tracking-tight'>
            Statistics
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='text-secondary justify-start leading-tight tracking-tight'>
              Unique domains
            </div>
            <div className='text-secondary justify-end text-right leading-tight'>
              <AnimatedNumber value={uniqueDomains} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='text-secondary justify-start leading-tight tracking-tight'>
              Unique selectors
            </div>
            <div className='text-secondary justify-end text-right leading-tight'>
              <AnimatedNumber value={uniqueSelectors} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='text-secondary justify-start leading-tight tracking-tight'>
              Domain/selector-pairs
            </div>
            <div className='text-secondary justify-end text-right leading-tight'>
              <AnimatedNumber value={DSP} />
            </div>
          </div>
          <div className='flex w-full items-center justify-between'>
            <div className='text-secondary justify-start leading-tight tracking-tight'>
              DKIM keys
            </div>
            <div className='text-secondary justify-end text-right leading-tight'>
              <AnimatedNumber value={DKIMkey} />
            </div>
          </div>
        </div>
        <div className='bg-background flex items-center justify-around self-stretch overflow-hidden rounded-lg px-3 py-2'>
          <div className='text-primary flex-1 justify-start leading-tight tracking-tight'>
            Browse our JWT key directory
          </div>
          <div data-name='ArrowRight' className='relative h-4 w-4'>
            <ArrowRightIcon
              size={16}
              weight='bold'
              className='bg-Grey-900 absolute text-[#111314] dark:text-[#E8E8E8]'
            />
          </div>
        </div>
      </div>
    </main>
  );
}
