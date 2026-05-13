/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import {
  ArrowCounterClockwiseIcon,
  EnvelopeIcon,
  QuestionIcon,
  SignOutIcon,
} from '@phosphor-icons/react';
import Image from 'next/image';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

import type { AddDspResponse } from '@/app/api/dsp/route';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RawEmailResponse } from '@/hooks/useGmailClient';
import { fetchEmailList, fetchEmailsRaw } from '@/hooks/useGmailClient';
import { analytics } from '@/lib/analytics';
import {
  type DomainSelectorPair,
  getFileContent,
  parseMailboxPairs,
  parseTsvPairs,
} from '@/lib/utils';

import Calendar from '../search/Calendar';
import DragAndDropFile from './DragAndDropFile';
import ProcessedLogs, { type LogResultItem } from './ProcessedLogs';

const MAX_EMPTY_PAGE_RETRIES = 5;

const SCRAPER_README_URL =
  'https://github.com/zkemail/archive.zk.email?tab=readme-ov-file#mailbox_scraper';

type UploadMode = 'mailbox' | 'tsv';

const EmailUploader = ({
  setIsDataFetching,
}: {
  setIsDataFetching: Dispatch<SetStateAction<boolean>>;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode | null>(null);
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
  // Persists true once upload starts - prevents reverting to filter screen on error
  const [uploadStarted, setUploadStarted] = useState(false);

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

  //TODO: currently it is not used, we are still using /api/gmail as used in older archive, but this need to come to client side.
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

    setUploadStarted(true); // Persist view transition
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

  // Reset to start a new upload session
  const handleNewUpload = () => {
    setUploadStarted(false);
    setIsProcessingEmails(false);
    setIsPaused(false);
    isPausedRef.current = false;
    setLogResults([]);
    setProcessedCount(0);
    setTotalMessages(null);
    setAddedCount(0);
    setUploadError(null);
    setApiPageToken(null);
    setIsDataFetching(false);
    setFile(null);
    setUploadMode(null);
  };

  // Submit a list of pre-extracted {domain, selector} pairs to /api/dsp,
  // streaming the log + count UI as each one resolves. Shared between the
  // mailbox (.mbox / .eml) and TSV upload paths — the only difference is
  // which parser produced the list.
  const submitPairs = async (
    pairs: DomainSelectorPair[],
    source: UploadMode
  ) => {
    setTotalMessages(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      const { domain, selector } = pairs[i];
      setProcessedCount(i + 1);
      try {
        const response = await fetch('/api/dsp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, selector }),
        });
        const data: AddDspResponse = await response.json();
        const logItem: LogResultItem = {
          id: `${source}-${Date.now()}-${i}-${domain}-${selector}`,
          domain,
          selector,
          timestamp: new Date().toISOString(),
          isAdded: data.addResult?.added ?? false,
          isUpdated:
            (data.addResult?.already_in_db ?? false) &&
            !(data.addResult?.added ?? false),
        };
        setLogResults((prev) => [...prev, logItem]);
        if (data.addResult?.added) {
          setAddedCount((prev) => prev + 1);
        }
      } catch (err) {
        console.error(`Error adding ${domain}/${selector}:`, err);
        // Continue with next pair
      }
    }
  };

  const handleProcessFile = async () => {
    if (!file || !uploadMode) return;

    analytics.capture('file_process_start', { source: uploadMode });
    setUploadStarted(true);
    setIsProcessingEmails(true);
    setIsDataFetching(true);
    setUploadError(null);
    setLogResults([]);
    setAddedCount(0);
    setProcessedCount(0);

    try {
      const content = await getFileContent(file);
      if (!content) {
        throw new Error('Could not read file content');
      }

      const pairs =
        uploadMode === 'tsv'
          ? parseTsvPairs(content)
          : parseMailboxPairs(content);

      if (pairs.length === 0) {
        throw new Error(
          uploadMode === 'tsv'
            ? 'No domain/selector pairs found in TSV file'
            : 'No DKIM signatures found in mailbox file'
        );
      }

      await submitPairs(pairs, uploadMode);
      setIsProcessingEmails(false);
    } catch (error) {
      console.error('Error processing file:', error);
      setUploadError(
        error instanceof Error ? error.message : 'Failed to process file'
      );
      setIsProcessingEmails(false);
    }
  };

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

  const handleFileSelect = (mode: UploadMode) => (selected: File | null) => {
    if (!selected) {
      if (uploadMode === mode) {
        setFile(null);
        setUploadMode(null);
      }
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Please split it into smaller files.`
      );
      return;
    }
    setUploadError(null);
    analytics.capture('file_upload_start', {
      fileType: selected.name.split('.').pop(),
      mode,
    });
    setFile(selected);
    setUploadMode(mode);
  };

  const uploadSectionLabel = (
    label: string,
    tooltip: string,
    helpHref: string,
    helpLabel: string
  ) => (
    <div className='flex w-full flex-col gap-1'>
      <div className='inline-flex items-center gap-2 self-start text-base leading-tight font-medium text-primary'>
        <span>{label}</span>
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                aria-label='Help'
                className='cursor-help text-secondary'
              >
                <QuestionIcon size={16} color='#606060' />
              </button>
            </TooltipTrigger>
            <TooltipContent className='max-w-xs'>{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <a
        href={helpHref}
        target='_blank'
        rel='noreferrer noopener'
        className='self-start text-sm text-accent-foreground-blue underline'
      >
        {helpLabel}
      </a>
    </div>
  );

  const emailUploadOptions = (
    <div className='flex w-full flex-col items-center justify-center gap-6'>
      <div className='flex w-full flex-col items-center justify-center gap-3'>
        <Button
          className='flex w-max items-center gap-2 px-6 text-base leading-none font-semibold'
          onClick={() => {
            analytics.capture('gmail_connect');
            setIsFetchEmailLoading(true);
            setFile(null);
            setUploadMode(null);
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

        {/* Mailbox upload — we extract DKIM pairs from each message. */}
        {uploadSectionLabel(
          'Upload mailbox file (.mbox or .eml)',
          'Drop a Gmail Takeout / Apple Mail / Thunderbird export (.mbox) or a single saved email (.eml). We read each message and extract its DKIM domain + selector pairs locally before uploading them.',
          SCRAPER_README_URL,
          'How to export your mailbox?'
        )}
        <DragAndDropFile
          accept='.mbox,.eml'
          file={uploadMode === 'mailbox' ? file : null}
          setFile={handleFileSelect('mailbox')}
        />

        <div className='flex w-full items-center gap-3'>
          <Separator className='flex-1' />
          <span className='text-base font-semibold text-secondary'>OR</span>
          <Separator className='flex-1 rotate-180' />
        </div>

        {/* TSV upload — pre-extracted pairs (e.g. from the legacy scraper). */}
        {uploadSectionLabel(
          'Upload TSV file (pre-extracted pairs)',
          "A TSV file with two columns: domain and selector. This is what the old archive's mbox_scraper.py / pst_scraper.py scripts produce locally — useful if you want to keep your mailbox off our servers.",
          SCRAPER_README_URL,
          'How to produce the TSV?'
        )}
        <DragAndDropFile
          accept='.tsv'
          file={uploadMode === 'tsv' ? file : null}
          setFile={handleFileSelect('tsv')}
        />

        {uploadError && !file && (
          <div className='w-full text-sm text-destructive'>{uploadError}</div>
        )}

        {/* Process File button - shown after file is uploaded */}
        {file && (
          <Button
            onClick={handleProcessFile}
            className='mt-4 inline-flex items-center justify-center gap-2 overflow-hidden rounded-lg px-6 py-3'
          >
            <div className='flex w-auto items-center justify-center gap-2'>
              <EnvelopeIcon size={16} weight='bold' />
              <div>Process {uploadMode === 'tsv' ? 'TSV' : 'Mailbox'} File</div>
            </div>
          </Button>
        )}
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
              When you sign in with your Gmail account or upload a mailbox file,
              the site reads the DKIM-Signature header from each email message
              and extracts only the domain and selector. A signature can look
              something like this:
            </div>
            <div className='rounded-lg border border-border p-4 text-xs leading-none font-light'>
              DKIM-Signature: v=1; a=rsa-sha256; d=example.net; s=brisbane;
              c=relaxed/simple; q=dns/txt; i=foo@eng.example.net; t=1117574938;
              x=1118006938; l=200; h=from:to:subject:date:keywords:keywords;
              z=From:foo@eng.example.net|To:joe@example.com|
              Subject:demo=20run|Date:July=205,=202005=203:44:08=20PM=20-0700;
              bh=MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=;
              b=dzdVyOfAKCdLXdJOc9G2q8LoXSlEniSbav+yuU4zGeeruD00lszZ
              VoG4ZHRNiYzR
            </div>
            <div className='text-base leading-tight font-medium text-secondary'>
              In the example above, the domain is example.net and the selector
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
      {/* Show "Start New Upload" when upload is completed (not processing/paused) */}
      {!isProcessingEmails && !isPaused && logResults.length > 0 && (
        <div className='flex justify-center self-stretch pt-2'>
          <Button
            onClick={handleNewUpload}
            variant='outline'
            className='flex items-center gap-2'
          >
            <ArrowCounterClockwiseIcon size={16} weight='bold' />
            Start New Upload
          </Button>
        </div>
      )}
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
  // uploadStarted persists even after errors/completion to prevent reverting to filter
  const hasStartedUpload =
    uploadStarted || isProcessingEmails || isPaused || logResults.length > 0;

  return (
    <div className='w-full'>
      {/* Check hasStartedUpload FIRST - applies to both file and Gmail uploads */}
      {hasStartedUpload
        ? // Upload in progress or completed - show logs
          emailFetchData
        : !isAuthenticated
          ? // Not signed in - show Gmail connect + file upload options
            emailUploadOptions
          : hasGmailScope === false
            ? // Signed in but no Gmail scope - show error
              insufficientPermissions
            : // Signed in but not started - show filters + upload button
              emailFetchFilter}
    </div>
  );
};

export default EmailUploader;
