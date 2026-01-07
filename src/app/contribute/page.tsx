'use client';
import Image from 'next/image';
import { useState } from 'react';

import EmailUploader from './EmailUploader';

export default function Home() {
  const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
  return (
    <div
      className={`mt-8 mb-8 flex flex-col items-center justify-center ${isDataFetching && 'mt-32 sm:mt-8'}`}
    >
      <div
        className={`relative mx-auto aspect-12/5 border-border ${isDataFetching && 'sm:aspect-9/2'} w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border`}
      >
        <div className='absolute bottom-0 z-40 inline-flex flex-col items-start justify-start p-6'>
          <div className='flex justify-start text-[clamp(2rem,3.34vw,3rem)] font-bold text-white capitalize'>
            Contribute
          </div>
          <div className='flex justify-start text-[clamp(1rem,1.39vw,1.25rem)] leading-5 font-semibold tracking-tight text-white'>
            <span className='whitespace-normal'>
              By uploading DKIM pairs from your Gmail account or from a TSV
              file.
            </span>
          </div>
        </div>
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-gradient-to-b from-sky-900/0 to-sky-900/90 blur-[2px] md:h-20'></div>
        <Image
          src='/header-contribute.png'
          alt='Home page header image'
          fill={true}
          className='object-cover'
        />
      </div>
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        <EmailUploader setIsDataFetching={setIsDataFetching} />
      </div>
    </div>
  );
}
