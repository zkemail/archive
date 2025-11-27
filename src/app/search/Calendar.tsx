'use client';

import { CalendarBlankIcon, XIcon } from '@phosphor-icons/react';
import { format } from 'date-fns';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Calendar as CalenderShadCN } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface CalendarProps {
  date?: Date;
  onChange?: (date: Date | undefined) => void;
}

export default function Calendar({
  date: controlledDate,
  onChange,
}: CalendarProps) {
  const [open, setOpen] = React.useState(false);
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(
    undefined
  );

  // Use controlled date if provided, otherwise fall back to internal state
  const isControlled = controlledDate !== undefined || onChange !== undefined;
  const date = isControlled ? controlledDate : internalDate;

  const handleDateChange = (newDate: Date | undefined) => {
    if (onChange) {
      onChange(newDate);
    }
    if (!isControlled) {
      setInternalDate(newDate);
    }
  };

  const handleClear = () => handleDateChange(undefined);
  const currentDate: Date = new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild className='w-full'>
        <div className='flex flex-row items-center justify-between rounded-lg border border-input px-3 py-2'>
          <Button
            variant='ghost'
            id='date'
            className={`flex h-auto justify-between p-0 font-normal`}
          >
            <div className='flex flex-row items-center justify-start gap-2'>
              <CalendarBlankIcon size={16} weight='bold' color='#606060' />
              <div className={`${date ? 'opacity-100' : 'opacity-40'}`}>
                {date
                  ? format(date, 'dd/MM/yyyy')
                  : format(currentDate, 'dd/MM/yyyy')}
              </div>
            </div>
          </Button>
          <Button
            className='hidden h-auto p-0 sm:flex'
            variant='ghost'
            onClick={() => handleClear()}
          >
            <XIcon size={16} color='#606060' />
          </Button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className='w-auto overflow-hidden border-0 p-0'
        align='start'
      >
        <CalenderShadCN
          mode='single'
          selected={date}
          captionLayout='dropdown'
          onSelect={(newDate) => {
            handleDateChange(newDate);
            setOpen(false);
          }}
          className='w-auto shadow-sm sm:[--cell-size:--spacing(10.5)] [[data-slot=card-content]_&]:bg-background [[data-slot=popover-content]_&]:bg-foreground'
        />
      </PopoverContent>
    </Popover>
  );
}
