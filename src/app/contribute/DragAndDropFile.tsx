'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const DragAndDropFile = ({
  accept,
  title,
  helpText,
  file,
  setFile,
  errorMessage,
  tooltipComponent,
}: {
  accept: string;
  title?: string;
  helpText?: string;
  file: File | null;
  setFile: (file: File | null) => void;
  errorMessage?: string;
  tooltipComponent?: React.ReactNode;
}) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const strokeColor = isDarkMode ? '%233B3B3BFF' : '%23D4D4D4FF';

  const handleDropzoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleDropzoneKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };
  return (
    <div className='flex w-full flex-col gap-4'>
      {title ? (
        <div className='flex flex-row gap-2'>
          <Label className='text-grey-900 text-base' htmlFor={title}>
            {title}
          </Label>

          {tooltipComponent ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Image
                    src='/assets/Info.svg'
                    alt='info'
                    width={16}
                    height={16}
                  />
                </TooltipTrigger>
                <TooltipContent>{tooltipComponent}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      ) : null}
      <div
        className='w-full cursor-pointer rounded-lg p-8'
        role='button'
        tabIndex={0}
        aria-label={
          file
            ? `File uploaded: ${file.name}. Click to change file`
            : 'Click or drop a file to upload'
        }
        onClick={handleDropzoneClick}
        onKeyDown={handleDropzoneKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer.files;
          if (files?.[0]) {
            setFile(files[0]);
          }
        }}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' stroke='${strokeColor}' stroke-width='4' stroke-dasharray='6%2c 14' stroke-dashoffset='2' stroke-linecap='square'/%3e%3c/svg%3e")`,
        }}
      >
        <div className='flex flex-col items-center justify-center gap-4'>
          {file ? (
            <>
              <Image
                src='/assets/CheckCircle.svg'
                alt='Upload icon'
                width={40}
                height={40}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                }}
              />
              <div className='flex flex-col items-center text-base font-semibold'>
                <p className='text-grey-800'>
                  {file.name} <span className='text-grey-700'>(Uploaded)</span>
                </p>
                <Button
                  variant='link'
                  className='text-grey-700'
                  startIcon={
                    <Image
                      src='/assets/Trash.svg'
                      alt='Trash icon'
                      width={16}
                      height={16}
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                      }}
                    />
                  }
                  onClick={() => {
                    setFile(null);
                  }}
                >
                  Delete file
                </Button>
              </div>
            </>
          ) : (
            <>
              <Image
                src='/assets/FileArrowUp.svg'
                alt='Upload icon'
                width={40}
                height={40}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                }}
              />
              <div className='flex flex-col items-center text-base font-semibold'>
                <p className='text-accent-foreground-blue'>
                  Click to upload{' '}
                  <span className='text-secondary'>or drop here</span>
                </p>
                <p className='text-accent-foreground-blue underline'>
                  How to get the PST/MBOX file?
                </p>
              </div>
            </>
          )}
          <Input
            ref={fileInputRef}
            id={fileInputId}
            type='file'
            accept={accept}
            className='hidden'
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file) {
                setFile(file);
              }
            }}
          />
        </div>
      </div>
      {errorMessage || helpText ? (
        <p
          className={cn(
            'text-grey-600 text-base',
            errorMessage ? 'text-red-500' : ''
          )}
        >
          {errorMessage || helpText}
        </p>
      ) : null}{' '}
    </div>
  );
};

export default DragAndDropFile;
