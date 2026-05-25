import {
  ArrowsCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  FlagIcon,
} from '@phosphor-icons/react';
import React, { useRef, useState } from 'react';

import { type SearchResponse, type SearchResult } from '@/app/actions';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { analytics } from '@/lib/analytics';
import { formatDate } from '@/lib/utils';

import { Badge } from '../../components/ui/badge';
import ActivityChart from './ActivityChart';

const isExpired = (lastActive: string) => {
  const lastActiveDate = new Date(lastActive);
  const now = new Date();
  const daysDiff =
    (now.getTime() - lastActiveDate.getTime()) / (1000 * 3600 * 24);
  return daysDiff > 365;
};

interface SelectorDetailsProps {
  data: SearchResponse;
}

const SelectorDetails = ({ data }: SelectorDetailsProps) => {
  type DetailRowProps = {
    label: React.ReactNode;
    children: React.ReactNode;
    className?: string;
  };

  const [openItems, setOpenItems] = useState<{ [key: string]: boolean }>({});
  const [activeDomain, setActiveDomain] = useState<string>('all');
  const domainRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);

  const DetailRow: React.FC<DetailRowProps> = ({
    label,
    children,
    className = '',
  }) => (
    <div
      className={`grid grid-cols-3 items-start gap-2 sm:gap-4 md:gap-6 ${className}`}
    >
      <div className='min-w-0 pr-2 text-base leading-tight font-normal tracking-tight text-ring'>
        {label}
      </div>
      <div className='col-span-2 min-w-0 text-base leading-tight font-normal tracking-tight break-words'>
        {children}
      </div>
    </div>
  );

  const toggleAccordion = (
    itemId: string,
    domain: string,
    selector: string
  ) => {
    const isOpening = !openItems[itemId];
    setOpenItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
    if (isOpening) {
      analytics.capture('selector_expanded', { domain, selector });
    }
  };

  const scrollToDomain = (domain: string) => {
    setActiveDomain(domain);
    if (domain === 'all') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setTimeout(() => {
      const element = domainRefs.current[domain];
      if (element) {
        const stickyHeight =
          stickyHeaderRef.current?.getBoundingClientRect().height ?? 0;
        const y =
          element.getBoundingClientRect().top +
          window.scrollY -
          stickyHeight -
          16;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 100);
  };

  if (!data?.searchResults || !Array.isArray(data.searchResults)) {
    return <div className='text-red-500'>No data available</div>;
  }

  const groupedByDomain = data.searchResults.reduce(
    (acc: Record<string, SearchResult[]>, item: SearchResult) => {
      if (!acc[item.domain]) {
        acc[item.domain] = [];
      }
      acc[item.domain].push(item);
      return acc;
    },
    {}
  );

  // Preserve server order (exact-match domain first, then alphabetical)
  // rather than re-sorting alphabetically and burying the exact match.
  const domains = Object.keys(groupedByDomain);

  return (
    <div className='flex w-full flex-col gap-6'>
      <div ref={stickyHeaderRef} className='sticky top-0 z-10 bg-foreground'>
        <div className='flex flex-col flex-wrap gap-2'>
          {/*
            Cap the height of the domain pill list so a query that
            returns many matching domains (e.g. "x.com" with thousands
            of substring hits) doesn't push the rest of the page off
            screen. Without max-h here the sticky header expands to
            fill the viewport and the selector details below stay
            hidden even after clicking a pill.
          */}
          <div className='flex max-h-48 flex-wrap gap-2 overflow-y-auto pr-1'>
            <Button
              variant='ghost'
              key='all'
              onClick={() => scrollToDomain('all')}
              className={`flex h-auto items-center gap-1 rounded-md border px-2 py-1.5 text-sm leading-4.5 font-normal transition-colors ${
                activeDomain === 'all'
                  ? 'border-ring text-primary'
                  : 'border-border text-secondary'
              }`}
            >
              All
            </Button>
            {domains.map((domain) => (
              <Button
                key={domain}
                variant='ghost'
                onClick={() => scrollToDomain(domain)}
                className={`flex h-auto items-center gap-1 rounded-md border px-2 py-1.5 text-sm leading-4.5 font-normal transition-colors ${
                  activeDomain === domain
                    ? 'border-ring text-primary'
                    : 'border-border text-secondary'
                }`}
              >
                {domain}
              </Button>
            ))}
          </div>
          <div>
            <div className='text-base leading-tight tracking-tight text-secondary'>
              <span className='text-primary'>
                {domains.length} domain{domains.length !== 1 ? 's' : ''}
              </span>{' '}
              found
              {data.totalCount !== undefined && (
                <span className='ml-1'>
                  ({data.totalCount} total selectors)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {domains.map((domain) => (
        <div
          key={domain}
          ref={(el) => {
            domainRefs.current[domain] = el;
          }}
          className='scroll-mt-6 rounded-lg border border-border'
        >
          <div className='flex flex-col gap-1 border-border p-4'>
            <h3 className='text-xl leading-7 font-medium tracking-tight'>
              {domain}
            </h3>
            <p className='text-base leading-tight font-normal tracking-tight text-primary'>
              {groupedByDomain[domain].length} selector
              {groupedByDomain[domain].length !== 1 ? 's' : ''}{' '}
              <span className='text-secondary'>found</span>
            </p>
          </div>
          <div>
            {groupedByDomain[domain].map((item: SearchResult) => (
              <div key={item.id} className='border-t border-border'>
                <div className='flex flex-col gap-4 px-4 py-3'>
                  <DetailRow label='Selector'>
                    <div className='truncate font-mono text-sm overflow-ellipsis'>
                      {item.selector}
                    </div>
                  </DetailRow>
                  <DetailRow label='Status'>
                    <div className='flex flex-wrap items-center gap-1 sm:gap-2'>
                      <div className='flex flex-wrap items-center gap-1 sm:gap-2'>
                        <Badge
                          variant={
                            isExpired(item.lastActive) ? 'expired' : 'active'
                          }
                        >
                          {isExpired(item.lastActive) ? 'Expired' : 'Active'}
                        </Badge>
                        <Badge
                          variant='source'
                          className='text-xs text-secondary sm:text-sm'
                        >
                          {item.origin === 'Inbox Upload' ? (
                            <>
                              <EnvelopeSimpleIcon className='h-3 w-3 sm:h-4 sm:w-4' />
                              <span className='text-xs leading-none font-normal tracking-tight'>
                                Inbox Upload
                              </span>
                            </>
                          ) : (
                            <>
                              <ArrowsCounterClockwiseIcon className='h-3 w-3 text-secondary sm:h-4 sm:w-4' />
                              <span className='text-xs leading-none font-normal tracking-tight sm:hidden'>
                                Rev Eng
                              </span>
                              <span className='hidden text-xs leading-none font-normal tracking-tight sm:inline'>
                                Reverse Engineering
                              </span>
                            </>
                          )}
                        </Badge>
                        <FlagIcon
                          weight='fill'
                          className='h-3 w-3 text-icon-muted sm:h-4 sm:w-4'
                        />
                      </div>
                    </div>
                  </DetailRow>
                </div>

                <Accordion
                  type='single'
                  collapsible
                  className='w-full'
                  value={
                    openItems[String(item.id)]
                      ? `selector-detail-${item.id}`
                      : ''
                  }
                  onValueChange={() =>
                    toggleAccordion(String(item.id), domain, item.selector)
                  }
                >
                  <AccordionItem value={`selector-detail-${item.id}`}>
                    <AccordionTrigger className='p-4 font-normal tracking-tight text-secondary hover:no-underline'>
                      {openItems[String(item.id)]
                        ? 'Hide details'
                        : 'More Details'}
                    </AccordionTrigger>
                    <AccordionContent className='flex flex-col gap-4 px-4 pt-2'>
                      <div className='max-w-4xl'>
                        <ActivityChart
                          firstActive={new Date(item.firstActive)}
                          lastActive={new Date(item.lastActive)}
                        />
                      </div>

                      <DetailRow label='First seen'>
                        {formatDate(item.firstActive)}
                      </DetailRow>
                      <DetailRow label='Last seen'>
                        {formatDate(item.lastActive)}
                      </DetailRow>
                      <DetailRow label='Origin'>{item.origin}</DetailRow>

                      <DetailRow label='Value'>
                        <div className='font-mono text-xs leading-relaxed break-all'>
                          {item.value}
                        </div>
                      </DetailRow>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SelectorDetails;
