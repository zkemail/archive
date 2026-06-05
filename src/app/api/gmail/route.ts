import { verifyDKIMSignature } from '@zk-email/helpers/dist/dkim';
import { type gmail_v1, google } from 'googleapis';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { badRequest, serverError } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { processAndStoreEmailSignature } from '@/lib/storeEmailSignature';
import {
  type DomainAndSelector,
  getDkimSigsArray,
  parseDkimTagListV2,
  parseEmailHeader,
} from '@/lib/utils';
import {
  addDomainSelectorPair,
  type AddResult,
  type ProcessResult,
} from '@/lib/utilsServer';

// Input validation schema. We deliberately don't whitelist characters in
// gmailQuery: Gmail's search syntax includes parens, quotes, comparison
// operators, etc., and a narrow whitelist mis-rejects valid queries. The
// 200-char cap remains as a basic DoS guard; Gmail's API rejects truly
// malformed queries on its own.
const queryParamsSchema = z.object({
  pageToken: z.string().max(500).optional(),
  gmailQuery: z.string().max(200).optional(),
});

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

  const emailHeaders = parseEmailHeader(decodedEmailRaw);
  if (!emailHeaders) {
    throw new Error('missing headers');
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
      logger.debug('missing_dkim_signature', { messageId });
      continue;
    }
    const tags = parseDkimTagListV2(dkimSig);

    const domain = tags.d;
    if (!domain) {
      logger.debug('missing_d_tag', { messageId });
      continue;
    }
    const selector = tags.s;
    if (!selector) {
      logger.debug('missing_s_tag', { messageId });
      continue;
    }
    let addResult: AddResult = { already_in_db: false, added: false };
    let processResultBadSignatureError = false;

    try {
      // Verify DKIM signature; skip DNS if signature is bad
      await verifyDKIMSignature(decodedEmailRaw, domain, true, true, true);
    } catch (error) {
      logger.warn('dkim_verify_failed', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error && error.message?.includes('bad signature')) {
        processResultBadSignatureError = true;
      }
    }

    if (!processResultBadSignatureError) {
      addResult = await addDomainSelectorPair(domain, selector, 'api');
    }

    // If DNS check fails, and dkim key is not in DB, we calculate gcd via calling the processAndStoreEmailSignature function else we just store the email signature

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
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in via /api/auth/signin' },
      { status: 401 }
    );
  }

  const access_token = session.accessToken;
  if (!access_token) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Missing access_token' },
      { status: 403 }
    );
  }

  if (!session.hasGmailScope) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Gmail scope not granted' },
      { status: 403 }
    );
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
      : process.env.AUTH_GOOGLE_ID || '';
  const clientSecret =
    process.env.IS_PULL_REQUEST == 'true'
      ? process.env.PREVIEW_GOOGLE_CLIENT_SECRET
      : process.env.AUTH_GOOGLE_SECRET;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, baseUrl);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  oauth2Client.setCredentials({ access_token });

  // Validate query parameters
  const rawParams = {
    pageToken: request.nextUrl.searchParams.get('pageToken') || undefined,
    gmailQuery: request.nextUrl.searchParams.get('gmailQuery') || undefined,
  };

  const parseResult = queryParamsSchema.safeParse(rawParams);
  if (!parseResult.success) {
    logger.warn('gmail_invalid_params', {
      errors: parseResult.error.flatten().fieldErrors,
    });
    return badRequest(
      'Invalid query parameters',
      parseResult.error.flatten().fieldErrors
    );
  }

  const { pageToken, gmailQuery } = parseResult.data;
  const isFirstPage = !pageToken;

  let messagesTotal = null;
  if (isFirstPage) {
    try {
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });
      messagesTotal = profileResponse.data.messagesTotal;
    } catch (error) {
      logger.warn('gmail_profile_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const messageTotalParam = messagesTotal ? { messagesTotal } : {};

  interface GmailListParams {
    userId: string;
    maxResults: number;
    q?: string;
    pageToken?: string;
  }

  const listParams: GmailListParams = {
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

  const messages = listResults?.data?.messages || [];
  logger.debug('gmail_messages_fetched', { count: messages.length });

  const addDspResults: AddDspResult[] = [];

  // Process messages in parallel for better performance
  const messagePromises = messages
    .filter(
      (message): message is { id: string; threadId?: string } => !!message.id
    )
    .map(async (message) => {
      try {
        await handleMessage(message.id, gmail, addDspResults);
      } catch (e) {
        logger.warn('gmail_message_error', {
          messageId: message.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

  await Promise.allSettled(messagePromises);
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
    logger.error('gmail_route_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
