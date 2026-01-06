import {
  MinusIcon,
  PauseCircleIcon,
  PlayIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

import { Badge } from '../../components/ui/badge';

export interface LogResultItem {
  id: number | string;
  domain: string;
  selector: string;
  timestamp: string;
  isAdded?: boolean;
  isUpdated?: boolean;
}

interface ProcessedLogsProps {
  logResults: LogResultItem[];
  isProcessing?: boolean;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onClearLog?: () => void;
  onCollapse?: () => void;
}

const LogItem = ({ item }: any) => {
  const formatDate = (timestamp: string | number | Date) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  };

  const getBadgeVariant = (item: { isAdded: any; isUpdated: any }) => {
    if (item.isAdded) return 'active';
    if (item.isUpdated) return 'updated';
    return 'present';
  };

  const getBadgeText = (item: { isAdded: any; isUpdated: any }) => {
    if (item.isAdded) return 'Added';
    if (item.isUpdated) return 'Updated';
    return 'Present';
  };

  return (
    <div className='flex w-full flex-col gap-4 rounded-lg border border-border p-4'>
      <div className='grid grid-cols-5 items-start gap-2 sm:gap-4 md:gap-6'>
        <div className='min-w-0 pr-2 text-base leading-tight font-normal tracking-tight text-ring dark:text-secondary'>
          Domain
        </div>
        <div className='col-span-4 col-start-2 min-w-0 text-base leading-tight font-normal tracking-tight break-words sm:col-span-3'>
          {item.domain}
        </div>
        <div className='hidden min-w-0 pr-2 text-right text-base leading-tight font-normal tracking-tight text-ring sm:flex'>
          <Badge variant={getBadgeVariant(item)}>{getBadgeText(item)}</Badge>
        </div>
      </div>
      <div className='grid grid-cols-5 items-start gap-2 sm:gap-4 md:gap-6'>
        <div className='min-w-0 pr-2 text-base leading-tight font-normal tracking-tight text-ring dark:text-secondary'>
          Selector
        </div>
        <div className='col-span-4 col-start-2 min-w-0 truncate font-mono text-base leading-tight font-normal tracking-tight break-words overflow-ellipsis sm:col-span-3'>
          {item.selector}
        </div>
        <div className='col-span-1 hidden min-w-0 pr-2 text-right text-xs leading-tight font-normal tracking-tight text-ring sm:flex dark:text-secondary'>
          {formatDate(item.timestamp)}
        </div>
      </div>
      <div className='flex flex-row justify-between sm:hidden'>
        <div className='min-w-0 pr-2 text-right text-base leading-tight font-normal tracking-tight text-ring'>
          <Badge variant={getBadgeVariant(item)}>{getBadgeText(item)}</Badge>
        </div>
        <div className='min-w-0 pr-2 text-right text-xs leading-tight font-normal tracking-tight text-ring dark:text-secondary'>
          {formatDate(item.timestamp)}
        </div>
      </div>
    </div>
  );
};

const ProcessedLogs = ({
  logResults,
  isProcessing = false,
  isPaused = false,
  onPause,
  onResume,
  onClearLog,
  onCollapse,
}: ProcessedLogsProps) => {
  const statusText = isProcessing
    ? 'Uploading emails...'
    : isPaused
      ? 'Paused'
      : logResults.length > 0
        ? 'Upload complete'
        : 'Uploading emails';

  return (
    <div className='w-full rounded-lg border border-border bg-foreground dark:bg-background'>
      <div className='flex w-full flex-col justify-between gap-2 p-4 pb-4 sm:flex-row sm:items-center'>
        <div className='text-base leading-tight font-normal tracking-tight'>
          {statusText}
        </div>
        <div className='flex flex-row gap-3'>
          {isProcessing && !isPaused ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='flex w-full gap-1 bg-foreground p-2 text-accent-foreground-red ring ring-[#C72C22]/40'
              onClick={onPause}
            >
              <PauseCircleIcon size={16} weight='bold' aria-hidden='true' />
              Pause
            </Button>
          ) : isPaused ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='flex w-full gap-1 bg-foreground p-2 text-green-600 ring ring-green-600/40'
              onClick={onResume}
            >
              <PlayIcon size={16} weight='bold' aria-hidden='true' />
              Resume
            </Button>
          ) : null}
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='flex w-full gap-1 bg-foreground p-2 text-ring ring ring-[#606060]/50 dark:text-secondary'
            onClick={onClearLog}
          >
            <TrashIcon size={16} weight='bold' aria-hidden='true' />
            Clear Log
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='hidden bg-foreground p-2 text-ring ring ring-[#606060]/50 sm:flex dark:text-secondary'
            onClick={onCollapse}
            aria-label='Collapse log panel'
          >
            <MinusIcon size={16} weight='bold' aria-hidden='true' />
          </Button>
        </div>
      </div>
      <ScrollArea className='h-[560px] w-full rounded-b-md border-0 bg-foreground p-4 text-base leading-tight font-normal tracking-tight text-primary'>
        <div className='space-y-3'>
          {logResults.length === 0 ? (
            <div className='text-center text-secondary'>
              {isProcessing ? 'Processing emails...' : 'No results yet'}
            </div>
          ) : (
            logResults.map((item) => <LogItem key={item.id} item={item} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProcessedLogs;
