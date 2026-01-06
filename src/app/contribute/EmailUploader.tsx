/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { EnvelopeIcon, QuestionIcon, SignOutIcon } from '@phosphor-icons/react';
import Image from 'next/image';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

import type { GmailResponse } from '@/app/api/gmail/route';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Loader from '@/components/ui/loader';
import { Separator } from '@/components/ui/separator';
import { RawEmailResponse } from '@/hooks/useGmailClient';
import { fetchEmailList, fetchEmailsRaw } from '@/hooks/useGmailClient';
import { analytics } from '@/lib/analytics';
import { getFileContent } from '@/lib/utils';

import Calendar from '../search/Calendar';
import DragAndDropFile from './DragAndDropFile';
import ProcessedLogs, { type LogResultItem } from './ProcessedLogs';

const MAX_EMPTY_PAGE_RETRIES = 5;

const EmailUploader = ({
  onFileUpload,
  setIsDataFetching,
}: {
  onFileUpload: (file: File) => void;
  setIsDataFetching: Dispatch<SetStateAction<boolean>>;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fetchedEmails, setFetchedEmails] = useState<RawEmailResponse[]>([]);
  const [isFetchEmailLoading, setIsFetchEmailLoading] = useState(false);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [emailQuery, setEmailQuery] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<RawEmailResponse | null>(
    null
  );
  const [emailContent, setEmailContent] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState('');
  const emptyPageRetriesRef = useRef(0);

  // API fetching state
  const [logResults, setLogResults] = useState<LogResultItem[]>([]);
  const [isProcessingEmails, setIsProcessingEmails] = useState(false);
  const [apiPageToken, setApiPageToken] = useState<string | null>(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  const { data: session, status } = useSession();
  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated';
  const accessToken = session?.accessToken;
  const hasGmailScope = session?.hasGmailScope;

  // Filter state
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  useEffect(() => {
    const checkFileValidity = async (file: File | null) => {
      if (!file) return;
      const content = await getFileContent(file);
      if (content) {
        const subject = content.match(/Subject: (.*)/)?.[1] || 'No Subject';

        const selectedEmail = {
          emailMessageId: 'uploadedFile',
          subject,
          internalDate: (() => {
            const dateMatches = content.match(/Date: (.*)/g); // Find all "Date:" occurrences
            if (dateMatches && dateMatches.length > 0) {
              const lastDateMatch = dateMatches[dateMatches.length - 1]; // Take the last match
              const dateValue = lastDateMatch.split('Date: ')[1]; // Extract the actual date string
              const date = new Date(dateValue);
              if (!isNaN(date.getTime())) {
                return date.toISOString();
              }
            }
            return 'Invalid Date';
          })(),
          decodedContents: content,
        };

        setFetchedEmails([selectedEmail]);
      }
    };

    checkFileValidity(file);
  }, [file]);

  const handleFetchEmails = async () => {
    if (!accessToken) return;

    try {
      setIsFetchEmailLoading(true);
      const emailListResponse = await fetchEmailList(accessToken, {
        pageToken: pageToken || undefined,
        q: emailQuery || undefined,
      });

      const emailResponseMessages = emailListResponse.messages;
      if (emailResponseMessages?.length > 0) {
        const emailIds = emailResponseMessages.map((message) => message.id);
        const emails = await fetchEmailsRaw(accessToken, emailIds);

        if (emails.length === 0 && emailListResponse.nextPageToken) {
          emptyPageRetriesRef.current += 1;

          if (emptyPageRetriesRef.current >= MAX_EMPTY_PAGE_RETRIES) {
            console.warn(
              `Stopped fetching after ${MAX_EMPTY_PAGE_RETRIES} consecutive empty pages`
            );
            setPageToken(null);
            return;
          }

          setPageToken(emailListResponse.nextPageToken || null);
          handleFetchEmails();
          return;
        }

        // Reset counter on successful fetch
        emptyPageRetriesRef.current = 0;
        setFetchedEmails([...fetchedEmails, ...emails]);

        setPageToken(emailListResponse.nextPageToken || null);
      } else {
        setFetchedEmails([]);
      }
    } catch (error) {
      console.error('Error in fetching data:', error);
    } finally {
      setIsFetchEmailLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      handleFetchEmails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Construct Gmail query from filters
  const constructGmailQuery = () => {
    const queryParts: string[] = [];

    if (startDate) {
      const formatted = `${startDate.getFullYear()}/${String(startDate.getMonth() + 1).padStart(2, '0')}/${String(startDate.getDate()).padStart(2, '0')}`;
      queryParts.push(`after:${formatted}`);
    }

    if (endDate) {
      const formatted = `${endDate.getFullYear()}/${String(endDate.getMonth() + 1).padStart(2, '0')}/${String(endDate.getDate()).padStart(2, '0')}`;
      queryParts.push(`before:${formatted}`);
    }

    if (domainFilter.trim()) {
      queryParts.push(`from:${domainFilter.trim()}`);
    }

    return queryParts.join(' ');
  };

  const handleStartUpload = () => {
    analytics.capture('email_process_start', { source: 'gmail' });

    // Validate date range
    if (startDate && endDate && endDate < startDate) {
      setUploadError('End date must be after start date');
      return;
    }

    const query = constructGmailQuery();
    setEmailQuery(query || null);

    setIsProcessingEmails(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setIsDataFetching(true);

    // Pass query directly since setEmailQuery is async
    fetchFromGmailApiWithQuery(query || null);
  };

  // Separate function to pass query directly
  const fetchFromGmailApiWithQuery = async (
    gmailQuery: string | null,
    pageToken?: string | null
  ) => {
    if (isPausedRef.current) return;

    try {
      setUploadError(null);
      const params = new URLSearchParams();
      if (pageToken) params.set('pageToken', pageToken);
      if (gmailQuery) params.set('gmailQuery', gmailQuery);

      const response = await fetch(`/api/gmail?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch emails');
      }

      const data: GmailResponse = await response.json();

      // Set total messages on first page
      if (data.messagesTotal && !totalMessages) {
        setTotalMessages(data.messagesTotal);
      }

      // Transform addDspResults to log format
      const newLogItems: LogResultItem[] = data.addDspResults.map(
        (result, index) => ({
          id: `${Date.now()}-${index}-${result.domainSelectorPair.domain}-${result.domainSelectorPair.selector}`,
          domain: result.domainSelectorPair.domain,
          selector: result.domainSelectorPair.selector,
          timestamp: result.mailTimestamp || new Date().toISOString(),
          isAdded: result.addResult.added,
          isUpdated: result.addResult.already_in_db && !result.addResult.added,
        })
      );

      setLogResults((prev) => [...prev, ...newLogItems]);
      setProcessedCount((prev) => prev + data.messagesProcessed);
      setAddedCount(
        (prev) =>
          prev + data.addDspResults.filter((r) => r.addResult.added).length
      );

      // Continue fetching if there's more
      if (data.nextPageToken && !isPausedRef.current) {
        setApiPageToken(data.nextPageToken);
        // Small delay to avoid rate limiting
        setTimeout(
          () => fetchFromGmailApiWithQuery(gmailQuery, data.nextPageToken),
          500
        );
      } else {
        setIsProcessingEmails(false);
        setApiPageToken(null);
      }
    } catch (error) {
      console.error('Error fetching from Gmail API:', error);
      setUploadError(
        error instanceof Error ? error.message : 'An error occurred'
      );
      setIsProcessingEmails(false);
    }
  };

  const handlePauseUpload = () => {
    setIsPaused(true);
    isPausedRef.current = true;
    setIsProcessingEmails(false);
  };

  const handleResumeUpload = () => {
    setIsPaused(false);
    isPausedRef.current = false;
    setIsProcessingEmails(true);
    fetchFromGmailApiWithQuery(emailQuery, apiPageToken);
  };

  const handleClearLog = () => {
    setLogResults([]);
  };

  const emailUploadOptions = (
    <div className='flex w-full flex-col items-center justify-center gap-6'>
      <div className='flex w-full flex-col items-center justify-center gap-3'>
        <Button
          className='flex w-max items-center gap-2 px-6 text-base leading-none font-semibold'
          onClick={() => {
            analytics.capture('gmail_connect');
            setIsFetchEmailLoading(true);
            setFile(null);
            signIn('google');
          }}
        >
          <Image
            src='/assets/gmailIcon.png'
            alt='Google Logo'
            width={16}
            height={16}
          />
          Connect Gmail Account
        </Button>
        <div className='flex w-full items-center gap-3'>
          <Separator className='flex-1' />
          <span className='text-base font-semibold text-secondary'>OR</span>
          <Separator className='flex-1 rotate-180' />
        </div>
        <div className='inline-flex gap-2 self-start text-base leading-tight font-medium text-primary'>
          <div>Upload PST/MBOX file</div>
          <QuestionIcon size={16} color='#606060' />
        </div>
        <DragAndDropFile
          accept='.eml'
          file={file}
          tooltipComponent={
            <div className='border-grey-500 w-[380px] rounded-2xl border bg-white p-2'>
              <Image
                src='/assets/emlInfo.svg'
                alt='emlInfo'
                width={360}
                height={80}
              />
              <p className='text-grey-700 mt-3 text-base font-medium'>
                The test .eml file is a sample email used to check if all the
                provided patterns (regex) work correctly. This helps confirm
                everything is set up properly before blueprint creation. We
                always store this file locally and never send it to our server.
              </p>
            </div>
          }
          setFile={async (e) => {
            if (!e) return;
            analytics.capture('file_upload_start', {
              fileType: e.name.split('.').pop(),
            });
            setFile(e);
            onFileUpload(e);
          }}
        />
      </div>
      <Accordion
        type='single'
        collapsible
        className='w-full rounded-lg border border-border'
        value={openItem}
        onValueChange={setOpenItem}
      >
        <AccordionItem value={`contribute-info`}>
          <AccordionTrigger className='p-4 font-normal tracking-tight text-secondary hover:no-underline'>
            What exactly do we extract?
          </AccordionTrigger>
          <AccordionContent className='flex flex-col gap-4 px-4 pt-2'>
            <div className='text-base leading-tight font-medium text-secondary'>
              When you sign in with your Gmail account and press Start, the site
              will extract the DKIM-Signature field from each email message in
              your Gmail account. A signature can look something like this:
            </div>
            <div className='rounded-lg border border-border p-4 text-xs leading-none font-light'>
              DKIM-Signature: v=1; a=rsa-sha256; d=australia.net; s=brisbane;
              c=relaxed/simple; q=dns/txt; i=foo@eng.example.net; t=1117574938;
              x=1118006938; l=200; h=from:to:subject:date:keywords:keywords;
              z=From:foo@eng.example.net|To:joe@example.com|
              Subject:demo=20run|Date:July=205,=202005=203:44:08=20PM=20-0700;
              bh=MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=;
              b=dzdVyOfAKCdLXdJOc9G2q8LoXSlEniSbav+yuU4zGeeruD00lszZ
              VoG4ZHRNiYzR
            </div>
            <div className='text-base leading-tight font-medium text-secondary'>
              In the example above, the domain is australianet and the selector
              is brisbane. These are the values that will be extracted and
              uploaded to the archive.
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );

  // Show insufficient permissions message
  const insufficientPermissions = (
    <div className='flex w-full flex-col items-center justify-center gap-6'>
      <div className='inline-flex items-center justify-between self-stretch'>
        <div className='flex-1 justify-start'>
          <span className='text-base leading-tight font-normal tracking-tight text-primary'>
            Signed in
          </span>
          <span className='text-base leading-tight font-normal tracking-tight text-secondary'>
            {' '}
            as {session?.user?.email ?? 'Unknown'}
          </span>
        </div>
        <Button
          onClick={() => signOut()}
          className='flex h-auto items-center justify-between gap-1 rounded-md border-0 bg-accent-background-red px-2 py-1.5 leading-2 sm:bg-destructive'
        >
          <SignOutIcon size={16} className='text-destructive sm:text-white' />
          <div className='hidden justify-start text-sm leading-2 font-medium text-white sm:flex'>
            Sign Out
          </div>
        </Button>
      </div>
      <div className='rounded-lg border border-destructive bg-destructive/10 p-4'>
        <div className='text-base font-medium text-destructive'>
          Insufficient permissions
        </div>
        <div className='mt-2 text-sm text-secondary'>
          To use this feature, you need to grant permission to access email
          messages. Please{' '}
          <button
            onClick={() => signOut()}
            className='text-primary underline hover:no-underline'
          >
            sign out
          </button>{' '}
          and sign in again, granting the Gmail access permission.
        </div>
      </div>
    </div>
  );

  const emailFetchFilter = (
    <div className='flex w-full flex-col items-center justify-center gap-6'>
      <div className='inline-flex items-center justify-between self-stretch'>
        <div className='flex-1 justify-start'>
          <span className='text-base leading-tight font-normal tracking-tight text-primary'>
            Signed in
          </span>
          <span className='text-base leading-tight font-normal tracking-tight text-secondary'>
            {' '}
            as {session?.user?.email ?? 'Unknown'}
          </span>
        </div>
        <Button
          onClick={() => signOut()}
          className='flex h-auto items-center justify-between gap-1 rounded-md border-0 bg-accent-background-red px-2 py-1.5 leading-2 sm:bg-destructive'
        >
          <SignOutIcon size={16} className='text-destructive sm:text-white' />
          <div className='hidden justify-start text-sm leading-2 font-medium text-white sm:flex'>
            Sign Out
          </div>
        </Button>
      </div>
      <div className='flex h-auto flex-col items-start justify-start gap-4 self-stretch overflow-hidden'>
        <div className='inline-flex items-center justify-start gap-3 self-stretch'>
          <div className='justify-start text-base leading-tight font-normal tracking-tight text-primary'>
            Optional customization
          </div>
        </div>
        <div className='flex w-full flex-col items-start justify-start gap-3 self-stretch'>
          <div className='justify-start self-stretch text-base leading-tight font-normal tracking-tight text-primary'>
            Only upload emails from a particular domain
          </div>
          <Input
            placeholder='zkemail.com'
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className='flex w-full items-center justify-center gap-2 self-stretch rounded-lg border-border px-3 py-2'
          />
        </div>
        <div className='flex w-full flex-row gap-4'>
          <div className='flex w-full flex-col self-stretch'>
            <div className='self-stretch leading-tight tracking-tight text-primary'>
              Start Date
            </div>
            <Calendar
              date={startDate ?? undefined}
              onChange={(date) => setStartDate(date ?? null)}
            />
          </div>
          <div className='flex w-full flex-col self-stretch'>
            <div className='self-stretch leading-tight tracking-tight text-primary'>
              End Date
            </div>
            <Calendar
              date={endDate ?? undefined}
              onChange={(date) => setEndDate(date ?? null)}
            />
          </div>
        </div>
      </div>
      {uploadError && (
        <div className='w-full text-sm text-destructive'>{uploadError}</div>
      )}
      <div className='flex flex-col items-center justify-center gap-2 self-stretch'>
        <Button
          onClick={handleStartUpload}
          className='inline-flex items-center justify-center gap-2 overflow-hidden rounded-lg px-6 py-3'
        >
          <div className='flex w-auto items-center justify-center gap-2'>
            <EnvelopeIcon size={16} weight='bold' />
            <div>Upload Emails</div>
          </div>
        </Button>
      </div>
    </div>
  );

  const emailFetchData = (
    <div className='flex w-full flex-col items-center justify-center gap-6'>
      <div className='flex w-full flex-col items-start justify-start gap-3 text-secondary'>
        <div className='flex w-full items-center justify-between'>
          <div className='text-base leading-tight font-normal tracking-tight'>
            Domain/selector-pairs added
          </div>
          <div className='text-base leading-tight font-normal tracking-tight'>
            {addedCount}
          </div>
        </div>
        <div className='flex w-full items-center justify-between'>
          <div className='justify-start text-base leading-tight font-normal tracking-tight'>
            Pairs uploaded
          </div>
          <div className='justify-start text-right text-base leading-tight font-normal tracking-tight'>
            {logResults.length}
          </div>
        </div>
        <div className='flex w-full items-center justify-between'>
          <div className='justify-start text-base leading-tight font-normal tracking-tight'>
            Emails Processed
          </div>
          <div className='justify-start text-right text-base leading-tight font-normal tracking-tight'>
            {processedCount}
            {totalMessages ? ` of ${totalMessages}` : ''}
          </div>
        </div>
        {uploadError && (
          <div className='w-full text-sm text-destructive'>{uploadError}</div>
        )}
      </div>
      <div className='flex items-center justify-between self-stretch'>
        <div className='flex-1 justify-start'>
          <span className='text-base leading-tight font-normal tracking-tight text-primary'>
            Signed in
          </span>
          <span className='text-base leading-tight font-normal tracking-tight text-secondary'>
            {' '}
            as {session?.user?.email ?? 'Unknown'}
          </span>
        </div>
        <Button
          onClick={() => signOut()}
          className='flex h-auto items-center justify-between gap-1 rounded-md border-0 bg-accent-background-red px-2 py-1.5 leading-2 sm:bg-destructive'
        >
          <SignOutIcon size={16} className='text-destructive sm:text-white' />
          <div className='hidden justify-start text-sm leading-2 font-medium text-white sm:flex'>
            Sign Out
          </div>
        </Button>
      </div>
      <div className='flex h-auto flex-col items-start justify-start gap-4 self-stretch overflow-hidden'>
        <ProcessedLogs
          logResults={logResults}
          isProcessing={isProcessingEmails}
          isPaused={isPaused}
          onPause={handlePauseUpload}
          onResume={handleResumeUpload}
          onClearLog={handleClearLog}
        />
      </div>
    </div>
  );

  // Show loading while session is being fetched
  if (isLoading) {
    return (
      <div className='w-full'>
        <Loader />
      </div>
    );
  }

  // Determine which view to show based on state
  const hasStartedUpload =
    isProcessingEmails || isPaused || logResults.length > 0;

  return (
    <div className='w-full'>
      {!isAuthenticated
        ? // Not signed in - show Gmail connect + file upload options
          emailUploadOptions
        : hasGmailScope === false
          ? // Signed in but no Gmail scope - show error
            insufficientPermissions
          : hasStartedUpload
            ? // Upload in progress or completed - show logs
              emailFetchData
            : // Signed in but not started - show filters + upload button
              emailFetchFilter}
    </div>
  );
};

export default EmailUploader;
