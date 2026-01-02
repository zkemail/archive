import {
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { autocomplete } from '@/app/actions';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
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

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSearchValue(initialQuery);
  }, [initialQuery]);

  // Fetch autocomplete suggestions with debounce
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const results = await autocomplete(query);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (err) {
      console.error('Autocomplete error:', err);
      setSuggestions([]);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    setSelectedIndex(-1);

    // Debounce autocomplete
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 200);

    // Debounce search callback
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
      onSearchChange?.(value);
    }, 300);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchValue(suggestion);
    setShowSuggestions(false);
    setSuggestions([]);
    onSearchChange?.(suggestion);
    analytics.capture('autocomplete_selected', { domain: suggestion });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSuggestionClick(suggestions[selectedIndex]);
        } else {
          setShowSuggestions(false);
          onSearchChange?.(searchValue);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const handleClear = () => {
    setSearchValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    onSearchChange?.('');
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='w-full'>
      <div className='flex flex-col items-start justify-start gap-2 self-stretch'>
        <div className='justify-start self-stretch text-base leading-tight tracking-tight text-primary'>
          Search
        </div>
        <div className='flex w-full items-center gap-2'>
          <div className='relative flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2'>
            <MagnifyingGlassIcon size={16} color='#606060' weight='bold' />
            <div className='relative min-w-0 flex-1'>
              <Input
                ref={inputRef}
                placeholder='Domain name'
                value={searchValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() =>
                  suggestions.length > 0 && setShowSuggestions(true)
                }
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

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className='absolute top-full left-0 z-50 mt-1 w-full rounded-lg border border-border bg-foreground shadow-lg'
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className={`hover:bg-muted w-full px-3 py-2 text-left text-sm ${
                      index === selectedIndex ? 'bg-muted' : ''
                    } ${index === 0 ? 'rounded-t-lg' : ''} ${
                      index === suggestions.length - 1 ? 'rounded-b-lg' : ''
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
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
