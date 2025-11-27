import {
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';

import Calendar from './Calendar';

type SearchAndFilterSectionProps = {
  initialQuery?: string;
  onSearchChange?: (value: string) => void;
  onFilterChange?: (value: string) => void;
  onDateRangeChange?: (
    fromDate: Date | undefined,
    toDate: Date | undefined
  ) => void;
};

export function SearchAndFilterSection({
  initialQuery = '',
  onSearchChange,
  onFilterChange,
  onDateRangeChange,
}: SearchAndFilterSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(initialQuery);
  const [filterValue, setFilterValue] = useState('all');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    setSearchValue(initialQuery);
  }, [initialQuery]);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    onSearchChange?.(value);
  };

  const handleFilterChange = (value: string) => {
    setFilterValue(value);
    onFilterChange?.(value);
  };

  const handleFromDateChange = (date: Date | undefined) => {
    setFromDate(date);
    onDateRangeChange?.(date, toDate);
  };

  const handleToDateChange = (date: Date | undefined) => {
    setToDate(date);
    onDateRangeChange?.(fromDate, date);
  };

  const handleClear = () => handleSearchChange('');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='w-full'>
      <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
        <div className='justify-start self-stretch text-base leading-tight tracking-tight text-primary'>
          Search
        </div>
        <div className='flex w-full items-center gap-2'>
          <div className='flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2'>
            <MagnifyingGlassIcon size={16} color='#606060' weight='bold' />
            <div className='relative min-w-0 flex-1'>
              <Input
                placeholder='Domain name'
                value={searchValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                className='h-auto w-full border-0 bg-transparent p-0 text-base leading-tight tracking-tight ring-0 outline-0 focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              {searchValue && (
                <button
                  onClick={handleClear}
                  className='absolute top-1/2 right-0 -translate-y-1/2 hover:text-secondary focus:outline-none'
                  aria-label='Clear search'
                >
                  <XIcon size={20} weight='bold' color='#606060' />
                </button>
              )}
            </div>
          </div>

          <CollapsibleTrigger asChild>
            <Button
              variant='ghost'
              className='flex-shrink-0 rounded-lg border border-border bg-foreground hover:opacity-80'
              size='icon'
            >
              <SlidersHorizontalIcon size={16} weight='bold' color='#606060' />
              <span className='sr-only'>Toggle filter menu</span>
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent className='mt-3'>
        <div className='flex flex-col gap-4 self-stretch'>
          <div className='flex flex-row gap-2'>
            <Button
              onClick={() => handleFilterChange('all')}
              className={`h-auto cursor-pointer rounded-lg border-0 px-6 py-2 leading-tight font-normal tracking-tight ${filterValue === 'all' ? 'bg-selected text-background hover:opacity-90' : 'bg-background text-primary hover:opacity-90'}`}
            >
              All
            </Button>
            <Button
              onClick={() => handleFilterChange('active')}
              className={`h-auto cursor-pointer rounded-lg border-0 px-6 py-2 leading-tight font-normal tracking-tight ${filterValue === 'active' ? 'bg-selected text-background hover:opacity-90' : 'bg-background text-primary hover:opacity-90'}`}
            >
              Active
            </Button>
            <Button
              onClick={() => handleFilterChange('expired')}
              className={`h-auto cursor-pointer rounded-lg border-0 px-6 py-2 leading-tight font-normal tracking-tight ${filterValue === 'expired' ? 'bg-selected text-background hover:opacity-90' : 'bg-background text-primary hover:opacity-90'}`}
            >
              Expired
            </Button>
          </div>
          <div className='flex flex-row gap-4'>
            <div className='flex w-full flex-col gap-1 self-stretch'>
              <div className='self-stretch leading-tight tracking-tight text-primary'>
                Only show from date
              </div>
              <Calendar date={fromDate} onChange={handleFromDateChange} />
            </div>
            <div className='flex w-full flex-col gap-1 self-stretch'>
              <div className='self-stretch leading-tight tracking-tight text-primary'>
                To date
              </div>
              <Calendar date={toDate} onChange={handleToDateChange} />
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
