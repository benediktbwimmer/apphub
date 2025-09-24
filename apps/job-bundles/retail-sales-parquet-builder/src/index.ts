/**
 * Example job handler. Update this file to implement your bundle logic.
 */

type JobRunResult = {
  status?: 'succeeded' | 'failed' | 'canceled' | 'expired';
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  context.logger('Running sample job bundle', {
    parameters: context.parameters
  });
  await context.update({ sample: 'progress' });
  return {
    status: 'succeeded',
    result: {
      echoed: context.parameters
    }
  } satisfies JobRunResult;
}

export default handler;
