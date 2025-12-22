import { verifyDKIMSignature } from '@zk-email/helpers/dist/dkim';
import chalk from 'chalk';
import { type gmail_v1, google } from 'googleapis';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/auth';
import { logger } from '@/lib/logger';
import { processAndStoreEmailSignature } from '@/lib/store_email_signature';
import {
  type DomainAndSelector,
  getDkimSigsArray,
  parseDkimTagListV2,
  parseEmailHeaderV2,
} from '@/lib/utils';
import {
  addDomainSelectorPair,
  type AddResult,
  type ProcessResult,
} from '@/lib/utils_server';

async function handleMessage(
  messageId: string,
  gmail: gmail_v1.Gmail,
  resultArray: AddDspResult[]
) {
  const messageRes = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw',
  });
  const encodedEmailRaw = messageRes.data.raw;
  const decodedEmailRaw = Buffer.from(encodedEmailRaw!, 'base64').toString(
    'utf-8'
  );

  const emailHeaders = parseEmailHeaderV2(decodedEmailRaw);
  if (!emailHeaders) {
    throw 'missing headers';
  }
  let internalDate: Date | null = new Date(
    Number(messageRes.data.internalDate)
  );
  internalDate =
    internalDate instanceof Date && !isNaN(internalDate.getTime())
      ? internalDate
      : null;

  const dkimSigsArray: string[] = getDkimSigsArray(decodedEmailRaw);

  for (const dkimSig of dkimSigsArray) {
    if (!dkimSig) {
      logger.debug('missing_dkim_signature', { dkimSig });
      continue;
    }
    const tags = parseDkimTagListV2(dkimSig);

    const domain = tags.d;
    if (!domain) {
      logger.debug('missing_d_tag', { tags });
      continue;
    }
    const selector = tags.s;
    if (!selector) {
      logger.debug('missing_s_tag', { tags });
      continue;
    }
    let addResult: AddResult = { already_in_db: false, added: false };
    let processResultBadSignatureError = false;

    try {
      // Verify DKIM signature; skip DNS if signature is bad
      await verifyDKIMSignature(decodedEmailRaw, domain, true, true, true);
    } catch (error) {
      console.log(
        chalk.redBright(
          'Error verifying DKIM signature:\nDomain:',
          domain,
          '\n',
          error
        )
      );
      if (error instanceof Error && error.message?.includes('bad signature')) {
        processResultBadSignatureError = true;
      }
    }

    if (!processResultBadSignatureError) {
      addResult = await addDomainSelectorPair(domain, selector, 'api');
    }

    // If DNS check fails and DKIM key is not in DB, we calculate GCD
    const processResult = await processAndStoreEmailSignature(
      emailHeaders,
      dkimSig,
      tags,
      internalDate,
      addResult,
      processResultBadSignatureError
    );

    const domainSelectorPair = { domain, selector };
    resultArray.push({
      addResult,
      processResult,
      domainSelectorPair,
      mailTimestamp: internalDate?.toString(),
    });
  }
  return resultArray;
}

type AddDspResult = {
  addResult: AddResult;
  processResult: ProcessResult;
  domainSelectorPair: DomainAndSelector;
  mailTimestamp?: string;
};

export type GmailResponse = {
  messagesProcessed: number;
  messagesTotal?: number;
  addDspResults: AddDspResult[];
  nextPageToken: string | null;
};

async function handleRequest(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.email) {
    return new Response('Unauthorized. Sign in via api/auth/signin', {
      status: 401,
    });
  }

  const token = await getToken({ req: request });
  const access_token = token?.access_token as string | undefined;
  if (!access_token) {
    return NextResponse.json('Missing access_token', { status: 403 });
  }

  const headersList = await headers();
  const host = headersList.get('host');
  const baseUrl =
    process.env.NODE_ENV === 'development'
      ? `http://${host}/api/auth/callback/google`
      : `https://${host}/api/auth/callback/google`;
  const clientId =
    process.env.IS_PULL_REQUEST == 'true'
      ? process.env.PREVIEW_GOOGLE_CLIENT_ID
      : process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret =
    process.env.IS_PULL_REQUEST == 'true'
      ? process.env.PREVIEW_GOOGLE_CLIENT_SECRET
      : process.env.GOOGLE_CLIENT_SECRET;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, baseUrl);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  oauth2Client.setCredentials({ access_token });

  const pageToken = request.nextUrl.searchParams.get('pageToken');
  const gmailQuery = request.nextUrl.searchParams.get('gmailQuery');
  const isFirstPage = !pageToken;

  let messagesTotal = null;
  if (isFirstPage) {
    try {
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });
      messagesTotal = profileResponse.data.messagesTotal;
    } catch (error) {
      logger.error('gmail_profile_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const messageTotalParam = messagesTotal ? { messagesTotal } : {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listParams: any = {
    userId: 'me',
    maxResults: 10,
  };

  if (gmailQuery) {
    listParams.q = gmailQuery;
  }

  if (pageToken) {
    listParams.pageToken = pageToken;
  }

  let listResults;
  try {
    listResults = await gmail.users.messages.list(listParams);
  } catch (error) {
    logger.error('gmail_list_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    listResults = { data: { messages: [], nextPageToken: null } };
  }

  logger.debug('gmail_list_results', { listResults });

  const messages = listResults?.data?.messages || [];
  logger.debug('gmail_messages', { count: messages.length });

  const addDspResults: AddDspResult[] = [];
  logger.info('gmail_processing', { messageCount: messages.length });

  for (const message of messages) {
    if (!message.id) {
      logger.debug('gmail_message_no_id', { message });
      continue;
    }
    try {
      await handleMessage(message.id, gmail, addDspResults);
    } catch (e) {
      logger.error('gmail_message_handling_error', {
        messageId: message.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const nextPageToken = listResults.data.nextPageToken || null;
  const messagesProcessed = messages.length;
  const response: GmailResponse = {
    addDspResults,
    nextPageToken,
    messagesProcessed,
    ...messageTotalParam,
  };
  return NextResponse.json(response, { status: 200 });
}

export async function GET(request: NextRequest) {
  try {
    return await handleRequest(request);
  } catch (error) {
    logger.error('gmail_request_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      error instanceof Error ? error.message : String(error),
      { status: 500 }
    );
  }
}
