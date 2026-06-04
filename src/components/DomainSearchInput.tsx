'use client';

import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { autocomplete } from '@/app/actions';
import { Input } from '@/components/ui/input';
import { analytics } from '@/lib/analytics';

// Hard cap on each autocomplete request so a hung server action can't
// permanently stall the in-flight ref (and therefore the dropdown).
// Generous so that genuinely slow queries don't trip it, since this is a hang
// detector, not a tight latency bound.
const AUTOCOMPLETE_TIMEOUT_MS = 20000;

type DomainSearchInputProps = {
  initialQuery?: string;
  // Fired when the user commits a search (Enter, magnifier-click, picking
  // an autocomplete suggestion, or clearing the input back to empty).
  onSubmit: (value: string) => void;
  // True while the committed search is in flight. Drives the spinner inside
  // the magnifier button.
  isSearchLoading?: boolean;
  placeholder?: string;
};

export function DomainSearchInput({
  initialQuery = '',
  onSubmit,
  isSearchLoading = false,
  placeholder = 'Domain name',
}: DomainSearchInputProps) {
  const [searchValue, setSearchValue] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isAutocompleteFetching, setIsAutocompleteFetching] = useState(false);
  // Distinguishes "server returned no matches" (show "No suggestions for X")
  // from "request failed/timed out" (show a softer message that doesn't
  // imply zero results exist; pressing Enter may still find something).
  const [autocompleteFailed, setAutocompleteFailed] = useState(false);
  // Tracks the value most recently committed so the "Press Enter to search"
  // hint only shows when the input differs.
  const [committedValue, setCommittedValue] = useState(initialQuery);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  // Serialize autocomplete: at most one request in flight; latest queued
  // query is fired when the current one settles. Protects the backend from
  // per-keystroke requests during slow typing.
  const autocompleteInFlightRef = useRef(false);
  const autocompletePendingRef = useRef<string | null>(null);
  // After a commit, suppress any in-flight autocomplete result from
  // re-opening the dropdown. Cleared as soon as the user starts typing
  // again so the next session of autocomplete works normally.
  const suppressAutocompleteRef = useRef(false);

  useEffect(() => {
    // Keep the committed value in sync with the input when initialQuery
    // changes (e.g. browser back/forward updates `?q=`). Without this,
    // searchValue resets but committedValue lags, isDirty flips true, and
    // the "Press Enter to search" hint appears even though the input
    // matches the URL.
    setSearchValue(initialQuery);
    setCommittedValue(initialQuery);
  }, [initialQuery]);

  // True when the visible input no longer matches the last committed
  // search. While dirty: dropdown is sticky (won't close on outside click),
  // and the dropdown's footer prompts "Press Enter to search for X".
  const isDirty = searchValue.length > 0 && searchValue !== committedValue;
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (autocompleteInFlightRef.current) {
      autocompletePendingRef.current = query;
      return;
    }

    autocompleteInFlightRef.current = true;
    setIsAutocompleteFetching(true);
    setAutocompleteFailed(false);
    let current = query;

    try {
      while (current) {
        try {
          const results = await Promise.race([
            autocomplete(current),
            new Promise<string[]>((_, reject) =>
              setTimeout(
                () => reject(new Error('autocomplete timed out')),
                AUTOCOMPLETE_TIMEOUT_MS
              )
            ),
          ]);
          if (suppressAutocompleteRef.current) break;
          // Server can return undefined (e.g. stale-server-action errors in
          // dev). Guard so `.length` doesn't crash the page.
          setSuggestions(Array.isArray(results) ? results : []);
          setAutocompleteFailed(false);
          // Show the dropdown either way: an empty result list renders
          // a "No suggestions for X" message instead of going silent.
          setShowSuggestions(true);
        } catch (err) {
          console.error('Autocomplete error:', err);
          if (!suppressAutocompleteRef.current) {
            setSuggestions([]);
            setAutocompleteFailed(true);
          }
        }

        if (suppressAutocompleteRef.current) break;

        const next = autocompletePendingRef.current;
        autocompletePendingRef.current = null;
        if (!next || next === current) break;
        current = next;
      }
    } finally {
      autocompleteInFlightRef.current = false;
      setIsAutocompleteFetching(false);
    }
  }, []);

  const handleInputChange = (rawValue: string) => {
    // Allow ASCII alphanumerics, dots, dashes, and any Unicode letter,
    // number, or combining mark so IDN domains can be typed in any script.
    // Marks (\p{M}) cover Thai vowel signs (เกาะกูด), Vietnamese diacritics
    // (việt), Hindi vowels (हिन्दी), etc., since stripping them would silently
    // mangle valid input. Punycode conversion happens server-side.
    const value = rawValue.replace(/[^\p{L}\p{N}\p{M}.-]/gu, '');
    setSearchValue(value);
    setSelectedIndex(-1);
    // Resume autocomplete the moment the user starts typing again.
    suppressAutocompleteRef.current = false;
    // Clear any stale "couldn't load" message; the next fetch decides the
    // new state.
    setAutocompleteFailed(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value) {
      setSuggestions([]);
      setShowSuggestions(false);
      setCommittedValue('');
      setIsAutocompleteFetching(false);
      onSubmit('');
      return;
    }

    if (value.length < 2) {
      setSuggestions([]);
      setIsAutocompleteFetching(false);
      return;
    }

    // Treat the debounce window itself as "fetching" so the dropdown shows
    // its loading state immediately instead of going through a brief flash
    // of stale suggestions or "No suggestions".
    setIsAutocompleteFetching(true);

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  const cancelPendingAutocomplete = () => {
    suppressAutocompleteRef.current = true;
    autocompletePendingRef.current = null;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setIsAutocompleteFetching(false);
  };

  const commit = (value: string) => {
    cancelPendingAutocomplete();
    setShowSuggestions(false);
    setCommittedValue(value);
    onSubmit(value);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchValue(suggestion);
    setSuggestions([]);
    commit(suggestion);
    analytics.capture('autocomplete_selected', { domain: suggestion });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && selectedIndex >= 0) {
        handleSuggestionClick(suggestions[selectedIndex]);
      } else if (searchValue) {
        commit(searchValue);
      }
      return;
    }

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
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  // Close suggestions when clicking outside, unless the input is dirty,
  // in which case the dropdown stays visible to keep the "Press Enter to
  // search for X" hint in view.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        if (isDirtyRef.current) return;
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClear = () => {
    setSearchValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    setCommittedValue('');
    onSubmit('');
  };

  return (
    <div className='relative flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2'>
      <div className='relative min-w-0 flex-1'>
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={searchValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            } else if (searchValue.length >= 2) {
              setShowSuggestions(true);
              setIsAutocompleteFetching(true);
              fetchSuggestions(searchValue);
            }
          }}
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
      <button
        type='button'
        onClick={() => searchValue && commit(searchValue)}
        disabled={!searchValue || isSearchLoading}
        aria-label={isSearchLoading ? 'Searching' : 'Search'}
        className='ml-2 flex shrink-0 cursor-pointer items-center rounded-md bg-primary px-3 py-1 text-background transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-40'
      >
        {isSearchLoading ? (
          <div
            className='size-4 animate-spin rounded-full border-2 border-background border-t-transparent'
            role='status'
          />
        ) : (
          <MagnifyingGlassIcon size={16} weight='bold' />
        )}
      </button>

      {(showSuggestions || isDirty) && (
        <div
          ref={suggestionsRef}
          className='absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-foreground shadow-lg'
        >
          {isAutocompleteFetching ? (
            <div className='flex items-center gap-2 px-3 py-2 text-sm text-secondary'>
              <div
                className='size-3 animate-spin rounded-full border-2 border-secondary border-t-transparent'
                role='status'
              />
              Looking for domains…
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                className={`hover:bg-muted w-full px-3 py-2 text-left text-sm ${
                  index === selectedIndex ? 'bg-muted' : ''
                }`}
              >
                {suggestion}
              </button>
            ))
          ) : autocompleteFailed ? (
            <div className='px-3 py-2 text-sm text-secondary'>
              Couldn&apos;t load suggestions, press Enter to search
            </div>
          ) : (
            <div className='px-3 py-2 text-sm text-secondary'>
              No suggestions for &quot;{searchValue}&quot;
            </div>
          )}
          {isDirty && (
            <div className='border-t border-border px-3 py-1.5 text-xs text-secondary'>
              ↵ Press Enter to search for &quot;{searchValue}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
