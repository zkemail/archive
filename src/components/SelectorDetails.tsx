import {
  ArrowsCounterClockwiseIcon,
  CaretDownIcon,
  FlagIcon,
} from '@phosphor-icons/react';
import React from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

import { Badge } from './ui/badge';

const SelectorDetails = () => {
  type DetailRowProps = {
    label: React.ReactNode;
    children: React.ReactNode;
    className?: string;
  };

  const DetailRow: React.FC<DetailRowProps> = ({
    label,
    children,
    className = '',
  }) => (
    <div
      className={`grid grid-cols-3 items-start gap-2 sm:gap-4 md:gap-6 ${className}`}
    >
      <div className='min-w-0 pr-2 text-base leading-tight font-normal tracking-tight text-gray-600 dark:text-gray-400'>
        {label}
      </div>
      <div className='col-span-2 min-w-0 text-base leading-tight font-normal tracking-tight break-words'>
        {children}
      </div>
    </div>
  );

  return (
    <div className='flex w-full flex-col items-center gap-2'>
      <div className='flex w-full flex-col gap-4 px-4 py-3'>
        <DetailRow label='Selector'>
          <div className='truncate font-mono text-sm overflow-ellipsis'>
            7czdtvwxhuu3gaqucql53xrmpf777voz
          </div>
        </DetailRow>

        <DetailRow label='Status'>
          <div className='flex flex-wrap items-center gap-1 sm:gap-2'>
            <Badge variant='expired'>Expired</Badge>
            <Badge variant='source' className='text-xs sm:text-sm'>
              <ArrowsCounterClockwiseIcon className='h-3 w-3 sm:h-4 sm:w-4' />
              <span className='sm:hidden'>Rev Eng</span>
              <span className='hidden sm:inline'>Reverse Engineering</span>
            </Badge>
            <FlagIcon
              weight='fill'
              className='h-3 w-3 text-[#E8E8E8] sm:h-4 sm:w-4 dark:text-[#A8A8A8]'
            />
          </div>
        </DetailRow>
      </div>

      <Accordion type='single' collapsible className='w-full px-4 py-3'>
        <AccordionItem value='item-1'>
          <AccordionTrigger>More details</AccordionTrigger>
          <AccordionContent className='flex flex-col gap-4 pt-2'>
            <DetailRow label='First seen'>1/31/2024, 11:46:33 PM</DetailRow>

            <DetailRow label='Last seen'>1/31/2024, 11:46:33 PM</DetailRow>

            <DetailRow label='Origin'>Inbox upload</DetailRow>

            <DetailRow label='Value'>
              <div className='font-mono text-xs leading-relaxed break-all'>
                p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCL6EpTHy5EI9BFwvMJXDZ5aMHys9QxjhIV0gdZfrMBu189vJIOsYjLw12hRFX47vjVA9gCDR1zThwlxbMJHB6ANRSygByuVY/BnkUvlh5tMUJHHvsr8PhKqsZlx59P+JzVTOc4Q86xdBBGsTDTIIXJazXe1abIMmoW5s75xAVLEQIDAQAB
              </div>
            </DetailRow>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default SelectorDetails;
