import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { DomainSearchInput } from '@/components/DomainSearchInput';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { analytics } from '@/lib/analytics';

import Calendar from './Calendar';

type SearchAndFilterSectionProps = {
  initialQuery?: string;
  onSearchChange?: (value: string) => void;
  onFilterChange?: (value: string) => void;
  onDateRangeChange?: (
    fromDate: Date | undefined,
    toDate: Date | undefined
  ) => void;
  isSearchLoading?: boolean;
};

export function SearchAndFilterSection({
  initialQuery = '',
  onSearchChange,
  onFilterChange,
  onDateRangeChange,
  isSearchLoading = false,
}: SearchAndFilterSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterValue, setFilterValue] = useState('all');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  const handleFilterChange = (value: string) => {
    setFilterValue(value);
    onFilterChange?.(value);
    analytics.capture('filter_applied', { filterType: 'status', value });
  };

  const handleFromDateChange = (date: Date | undefined) => {
    setFromDate(date);
    onDateRangeChange?.(date, toDate);
    if (date) {
      analytics.capture('filter_applied', {
        filterType: 'fromDate',
        value: date.toISOString(),
      });
    }
  };

  const handleToDateChange = (date: Date | undefined) => {
    setToDate(date);
    onDateRangeChange?.(fromDate, date);
    if (date) {
      analytics.capture('filter_applied', {
        filterType: 'toDate',
        value: date.toISOString(),
      });
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='w-full'>
      <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
        <div className='justify-start self-stretch text-base leading-tight tracking-tight text-primary'>
          Search
        </div>
        <div className='flex w-full items-center gap-2'>
          <DomainSearchInput
            initialQuery={initialQuery}
            onSubmit={(value) => onSearchChange?.(value)}
            isSearchLoading={isSearchLoading}
          />
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
