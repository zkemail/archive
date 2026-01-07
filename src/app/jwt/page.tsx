'use client';

import { Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { type JWKSRecord, JWKSViewer } from '@/components/JWKSViewer';

export default function JWTPage() {
  const [records, setRecords] = useState<JWKSRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchJWKS() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/jwk_set');
        if (!response.ok) {
          throw new Error('Failed to fetch JWKS data');
        }
        const result = await response.json();
        const sorted = [...result].sort(
          (a: JWKSRecord, b: JWKSRecord) => a.id - b.id
        );
        setRecords(sorted);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    }

    fetchJWKS();
  }, []);

  return (
    <div className='mt-8 mb-8 flex flex-col items-center justify-center'>
      {/* Header */}
      <div className='relative mx-auto aspect-12/5 w-14/15 max-w-[720px] overflow-clip rounded-t-3xl border border-border md:aspect-9/2'>
        <div className='absolute bottom-0 z-40 inline-flex flex-col items-start justify-start p-6'>
          <div className='flex justify-start text-[clamp(2rem,3.34vw,3rem)] font-bold text-white capitalize'>
            JWT Keys
          </div>
          <div className='flex justify-start text-[clamp(1rem,1.39vw,1.25rem)] leading-5 font-semibold tracking-tight text-white'>
            <span className='whitespace-normal'>
              Browse Google&apos;s JWT keys and certificates
            </span>
          </div>
        </div>
        <div className='absolute -bottom-1 z-20 h-40 w-full bg-gradient-to-b from-sky-900/0 to-sky-900/90 blur-[2px] md:h-20'></div>
        <Image
          src='/header-home.png'
          alt='Home page header image'
          fill={true}
          className='object-cover'
        />
      </div>

      {/* Content */}
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        {isLoading && (
          <div className='flex w-full items-center justify-center py-12'>
            <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
          </div>
        )}

        {error && (
          <div className='w-full rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950/20 dark:text-red-400'>
            {error}
          </div>
        )}

        {!isLoading && !error && records.length === 0 && (
          <div className='text-muted-foreground w-full py-8 text-center'>
            No JWKS records found
          </div>
        )}

        {!isLoading &&
          records.map((record) => (
            <JWKSViewer key={record.id} record={record} />
          ))}
      </div>
    </div>
  );
}
