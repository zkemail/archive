import { CloudTasksClient } from '@google-cloud/tasks';

import { logger } from './logger';

export interface GcdCalculationPayload {
  s1: string | number;
  s2: string | number;
  em1: string | number;
  em2: string | number;
  taskId?: string;
  metadata?: Record<string, any>;
}

export async function createGcdCalculationTask(payload: GcdCalculationPayload) {
  let client: CloudTasksClient;
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ) {
    // Parse the JSON credentials from environment variable
    const credentials = JSON.parse(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    );
    client = new CloudTasksClient({
      credentials,
      projectId: credentials.project_id,
    });
  } else {
    // Use default credentials for local development
    client = new CloudTasksClient();
  }

  // Where the Cloud Function posts its result. This must not come from the
  // request. It was `https://${host}` off the incoming Host header, so a
  // spoofed Host sent the recovery to a server of the caller's choosing
  // (REG-737). The recovered key is public data, so the disclosure is minor,
  // but the legitimate result then never arrives, and it pointed
  // GCP-originated requests at arbitrary hosts on demand.
  //
  // Pinned to the canonical hostname, the same name statements are issued
  // under. CALLBACK_URL still overrides it in development, where the function
  // has to reach a tunnel rather than production.
  const baseUrl =
    process.env.NODE_ENV === 'development'
      ? process.env.CALLBACK_URL
      : 'https://archive.zk.email';

  const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
  const LOCATION = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
  const QUEUE_NAME = process.env.CLOUD_TASKS_QUEUE_NAME || '';
  const FUNCTION_URL = process.env.CLOUD_FUNCTION_URL || '';
  const SERVICE_ACCOUNT_EMAIL = process.env.TASKS_SERVICE_ACCOUNT_EMAIL;
  const CALLBACK_URL = baseUrl;

  try {
    const { s1, s2, em1, em2, taskId, metadata } = payload;

    if (!s1 || !s2 || !em1 || !em2) {
      throw new Error('Missing required parameters: s1, s2, em1, em2');
    }

    if (!CALLBACK_URL) {
      throw new Error('CALLBACK_URL environment variable not set');
    }

    if (!SERVICE_ACCOUNT_EMAIL) {
      throw new Error(
        'TASKS_SERVICE_ACCOUNT_EMAIL environment variable not set'
      );
    }

    const taskPayload = {
      s1: s1.toString(),
      s2: s2.toString(),
      em1: em1.toString(),
      em2: em2.toString(),
      callbackUrl: `${CALLBACK_URL}/api/gcd_result_callback`,
      taskId: taskId || `task_${Date.now()}`,
      metadata: metadata || {},
    };

    const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: FUNCTION_URL,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(taskPayload)),
        oidcToken: {
          serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        },
      },
      name: taskId ? `${parent}/tasks/${taskId}` : undefined,
    };

    const [response] = await client.createTask({ parent, task });
    logger.info('gcd_task_queued', { taskName: response.name });

    return {
      success: true,
      message:
        'Task created successfully. Result will be sent to available shortly',
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('gcd_task_creation_error', { error: errorMessage });
    throw new Error(`Failed to create task: ${errorMessage}`);
  }
}
