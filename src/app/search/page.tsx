'use client';

import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { type SearchFilters } from '@/app/actions';
import { DomainSearchResults } from '@/components/DomainSearchResult';

import { SearchAndFilterSection } from './SearchAndFilterSection';

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'expired'
  >('all');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    // Update URL without page reload
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set('q', value);
    } else {
      params.delete('q');
    }
    router.replace(`/search?${params.toString()}`);
  };

  const handleFilterChange = (value: string) => {
    setStatusFilter(value as 'all' | 'active' | 'expired');
  };

  const handleDateRangeChange = (
    from: Date | undefined,
    to: Date | undefined
  ) => {
    setFromDate(from);
    setToDate(to);
  };

  const filters: SearchFilters = useMemo(
    () => ({
      status: statusFilter,
      fromDate: fromDate?.toISOString(),
      toDate: toDate?.toISOString(),
    }),
    [statusFilter, fromDate, toDate]
  );

  return (
    <div className='my-8 flex flex-1 flex-col items-center'>
      <div className='relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border border-border md:aspect-9/2'>
        <div className='absolute bottom-0 z-40 inline-flex flex-col items-start justify-start p-6'>
          <div className='flex justify-start text-[clamp(2rem,3.34vw,3rem)] font-bold text-white capitalize'>
            DKIM Archive
          </div>
          <div className='flex justify-start text-[clamp(1rem,1.39vw,1.25rem)] leading-5 font-semibold tracking-tight text-white'>
            <span className='whitespace-normal'>
              Building the largest open-sourced directory of DKIM pairs.
            </span>
          </div>
        </div>
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-linear-to-b from-sky-900/0 to-sky-900/90 blur-[2px] md:h-20'></div>
        <Image
          src='/header-home.png'
          alt='Home page header image'
          fill={true}
          className='object-cover'
        />
      </div>
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <SearchAndFilterSection
            initialQuery={initialQuery}
            onSearchChange={handleSearchChange}
            onFilterChange={handleFilterChange}
            onDateRangeChange={handleDateRangeChange}
          />
        </div>
        <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
          <DomainSearchResults domainQuery={searchQuery} filters={filters} />
        </div>
      </div>
    </div>
  );
}
