import { verifyDKIMSignature } from '@zk-email/helpers/dist/dkim';
import { type gmail_v1, google } from 'googleapis';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { badRequest, serverError } from '@/lib/api-response';
import { ingestEmail, type SignatureResult } from '@/lib/ingestEmail';
import { logger } from '@/lib/logger';

// Input validation schema. We deliberately don't whitelist characters in
// gmailQuery: Gmail's search syntax includes parens, quotes, comparison
// operators, etc., and a narrow whitelist mis-rejects valid queries. The
// 200-char cap remains as a basic DoS guard; Gmail's API rejects truly
// malformed queries on its own.
const queryParamsSchema = z.object({
  pageToken: z.string().max(500).optional(),
  gmailQuery: z.string().max(200).optional(),
});

async function handleMessage(messageId: string, gmail: gmail_v1.Gmail) {
  const messageRes = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw',
  });
  if (!messageRes.data.raw) throw new Error('Missing raw message');
  const raw = Buffer.from(messageRes.data.raw, 'base64').toString('utf-8');
  const date = new Date(Number(messageRes.data.internalDate));
  return ingestEmail(raw, isNaN(date.getTime()) ? null : date, (domain) =>
    verifyDKIMSignature(raw, domain, true, true, true)
  );
}

export type GmailResponse = {
  messagesProcessed: number;
  messagesSucceeded: number;
  messagesFailed: number;
  signaturesStored: number;
  signaturesDuplicate: number;
  signaturesSkipped: number;
  signaturesFailed: number;
  recoveryFailures: number;
  messagesTotal?: number;
  addDspResults: SignatureResult[];
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

  const oauth2Client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID || '',
    process.env.AUTH_GOOGLE_SECRET,
    baseUrl
  );
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
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? Number(error.code)
        : 0;
    const status =
      code === 429 ? 429 : code === 401 || code === 403 ? code : 503;
    return NextResponse.json(
      {
        error: 'gmail_list_failed',
        message: 'Could not list Gmail messages. Retry this page.',
      },
      { status }
    );
  }

  const messages = listResults?.data?.messages || [];
  logger.debug('gmail_messages_fetched', { count: messages.length });

  const outcomes = await Promise.all(
    messages
      .filter((message) => !!message.id)
      .map(async (message) => {
        try {
          return await handleMessage(message.id!, gmail);
        } catch (error) {
          logger.warn('gmail_message_error', {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
  );
  const valid = outcomes.filter((outcome) => outcome !== null);
  const response: GmailResponse = {
    messagesProcessed: messages.length,
    messagesSucceeded: valid.filter((outcome) => outcome.signaturesFailed === 0)
      .length,
    messagesFailed: outcomes.filter(
      (outcome) => outcome === null || outcome.signaturesFailed > 0
    ).length,
    signaturesStored: valid.reduce((sum, r) => sum + r.signaturesStored, 0),
    signaturesDuplicate: valid.reduce(
      (sum, r) => sum + r.signaturesDuplicate,
      0
    ),
    signaturesSkipped: valid.reduce((sum, r) => sum + r.signaturesSkipped, 0),
    signaturesFailed: valid.reduce((sum, r) => sum + r.signaturesFailed, 0),
    recoveryFailures: valid.reduce((sum, r) => sum + r.recoveryFailures, 0),
    addDspResults: valid.flatMap((r) => r.addDspResults),
    nextPageToken: listResults.data.nextPageToken || null,
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
