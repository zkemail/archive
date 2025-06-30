import { MinusIcon, PauseCircleIcon, TrashIcon } from '@phosphor-icons/react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

import { Badge } from '../../components/ui/badge';

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
    <div className='border-border flex w-full flex-col gap-4 rounded-lg border p-4'>
      <div className='grid grid-cols-4 items-start gap-2 sm:gap-4 md:gap-6'>
        <div className='text-ring min-w-0 pr-2 text-base leading-tight font-normal tracking-tight'>
          Domain
        </div>
        <div className='col-span-2 min-w-0 text-base leading-tight font-normal tracking-tight break-words'>
          {item.domain}
        </div>
        <div className='text-ring min-w-0 pr-2 text-right text-base leading-tight font-normal tracking-tight'>
          <Badge variant={getBadgeVariant(item)}>{getBadgeText(item)}</Badge>
        </div>
      </div>
      <div className='grid grid-cols-4 items-start gap-2 sm:gap-4 md:gap-6'>
        <div className='text-ring min-w-0 pr-2 text-base leading-tight font-normal tracking-tight'>
          Selector
        </div>
        <div className='col-span-2 min-w-0 truncate font-mono text-base leading-tight font-normal tracking-tight break-words overflow-ellipsis'>
          {item.selector}
        </div>
        <div className='text-ring min-w-0 pr-2 text-right text-xs leading-tight font-normal tracking-tight'>
          {formatDate(item.timestamp)}
        </div>
      </div>
    </div>
  );
};

const ProcessedLogs = ({ logResults }: any) => {
  console.log(logResults.logResults);
  return (
    <div className='bg-foreground dark:bg-background border-border w-full rounded-lg border p-4'>
      <div className='flex w-full flex-col justify-between gap-2 pb-4 sm:flex-row sm:items-center'>
        <div className='text-base leading-tight font-normal tracking-tight'>
          Uploading emails
        </div>
        <div className='flex flex-row gap-3'>
          <Button
            variant='ghost'
            size='sm'
            className='text-accent-foreground-red bg-accent-background-red flex gap-1 border p-2'
          >
            <PauseCircleIcon size={16} weight='bold' />
            Pause
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='text-ring bg-foreground flex gap-1 border p-2'
          >
            <TrashIcon size={16} weight='bold' />
            Clear Log
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='hidden border p-2 sm:flex'
          >
            <MinusIcon size={16} weight='bold' />
          </Button>
        </div>
      </div>
      <ScrollArea className='bg-foreground text-primary h-[560px] w-full rounded-md border-0 p-4 text-base leading-tight font-normal tracking-tight'>
        <div className='space-y-4'>
          {logResults.logResults.map((item: { id: any }) => (
            <LogItem key={item.id} item={item} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProcessedLogs;
