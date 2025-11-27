'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';

import searchResults from '@/app/search/searchData.json';

import { SearchAndFilterSection } from './SearchAndFilterSection';
import SelectorDetails from './SelectorDetails';

export default function Home() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const data = searchResults;
  return (
    <div className='my-8 flex flex-col items-center justify-center'>
      <div className='border-border relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border md:aspect-9/2'>
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
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-gradient-to-b from-sky-900/0 to-sky-900/90 blur-[2px] md:h-20'></div>
        <Image
          src='/header-home.png'
          alt='Home page header image'
          fill={true}
          className='object-cover'
        />
      </div>
      <div className='bg-foreground border-border flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l p-6'>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <SearchAndFilterSection initialQuery={initialQuery} />
        </div>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <SelectorDetails data={data} />
        </div>
      </div>
    </div>
  );
}
