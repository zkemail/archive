'use client';

import {
  ArrowRightIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import {
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { autocomplete } from '@/app/actions';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Input } from '@/components/ui/input';
import { analytics } from '@/lib/analytics';
import { type ArchiveStats } from '@/lib/db';

interface HomeClientProps {
  stats: ArchiveStats;
}

export default function HomeClient({ stats }: HomeClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uniqueDomains, setUniqueDomains] = useState(0);
  const [uniqueSelectors, setUniqueSelectors] = useState(0);
  const [DSP, setDSP] = useState(0);
  const [DKIMkey, setDKIMkey] = useState(0);

  const handleSearch = (query?: string) => {
    const value = (query ?? searchQuery).trim();
    if (value) {
      analytics.capture('search', { query: value, source: 'homepage' });
      window.location.href = `/search?q=${encodeURIComponent(value)}`;
    }
  };

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const results = await autocomplete(query);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    setSelectedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 200);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    handleSearch(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        return;
      }
      if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleSuggestionClick(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter') handleSearch();
  };

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

    animateValue(setUniqueDomains, stats.uniqueDomains, 0);
    animateValue(setUniqueSelectors, stats.uniqueSelectors, 50);
    animateValue(setDSP, stats.domainSelectorPairs, 100);
    animateValue(setDKIMkey, stats.dkimKeys, 150);

    return () => {
      isMounted = false;
      timeoutIds.forEach((id) => clearTimeout(id));
      intervalIds.forEach((id) => clearInterval(id));
    };
  }, [stats]);

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
              <Link
                href='https://archive.zk.email/about'
                className='underline hover:opacity-80'
                target='_blank'
                rel='noreferrer noopener'
              >
                Read More
              </Link>
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
          <div className='relative my-0.25 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2'>
            <MagnifyingGlassIcon
              size={16}
              color='var(--secondary)'
              weight='bold'
            />
            <div className='relative min-w-0 flex-1'>
              <Input
                ref={inputRef}
                placeholder='Domain name'
                size='search'
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() =>
                  suggestions.length > 0 && setShowSuggestions(true)
                }
                className='flex-1 border-0 text-base leading-tight tracking-tight text-secondary outline-0'
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSuggestions([]);
                    setShowSuggestions(false);
                  }}
                  className='absolute top-1/2 right-0 -translate-y-1/2 hover:text-secondary focus:outline-none'
                  aria-label='Clear search'
                >
                  <XIcon size={20} weight='bold' color='#606060' />
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              className='flex items-center rounded-md bg-primary px-3 py-1 text-sm text-background transition-opacity hover:opacity-80'
            >
              Search
            </button>

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
        <Link
          href='/jwt'
          className='flex items-center justify-around self-stretch overflow-hidden rounded-lg bg-background px-3 py-2 transition-opacity hover:opacity-80'
          aria-label='Browse our JWT key directory'
        >
          <div className='flex-1 justify-start leading-tight tracking-tight text-primary'>
            Browse our JWT key directory
          </div>
          <div data-name='ArrowRight' className='relative h-4 w-4'>
            <ArrowRightIcon
              size={16}
              weight='bold'
              className='bg-Grey-900 absolute text-primary'
              aria-hidden='true'
            />
          </div>
        </Link>
      </div>
    </main>
  );
}
