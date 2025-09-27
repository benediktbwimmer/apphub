import { Worker } from 'bullmq';
import type { ExampleDescriptorReference } from '@apphub/example-bundler';
import { packageExampleBundle } from './exampleBundles/manager';
import {
  EXAMPLE_BUNDLE_QUEUE_NAME,
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode
} from './queue';

export type ExampleBundleJobData = {
  slug: string;
  force?: boolean;
  skipBuild?: boolean;
  minify?: boolean;
  descriptor?: ExampleDescriptorReference | null;
};

export type ExampleBundleJobResult = {
  slug: string;
  version: string;
  checksum: string;
  filename: string;
  fingerprint: string;
  cached: boolean;
};

const EXAMPLE_BUNDLE_CONCURRENCY = Number(process.env.EXAMPLE_BUNDLE_CONCURRENCY ?? 1);

const useInlineQueue = isInlineQueueMode();

export async function processExampleBundleJob(
  data: ExampleBundleJobData,
  jobId?: string
): Promise<ExampleBundleJobResult> {
  if (!data || typeof data.slug !== 'string' || data.slug.trim().length === 0) {
    throw new Error('Example bundle job requires a slug');
  }
  const result = await packageExampleBundle(
    { slug: data.slug, descriptor: data.descriptor ?? null },
    {
      force: data.force,
      skipBuild: data.skipBuild,
      minify: data.minify,
      jobId
    }
  );
  return {
    slug: result.slug,
    version: result.version,
    checksum: result.checksum,
    filename: result.filename,
    fingerprint: result.fingerprint,
    cached: result.cached
  } satisfies ExampleBundleJobResult;
}

async function runWorker(): Promise<void> {
  if (useInlineQueue) {
    console.warn('[example-bundles] Inline queue mode active; worker not started');
    return;
  }

  const connection = getQueueConnection();
  const worker = new Worker(
    EXAMPLE_BUNDLE_QUEUE_NAME,
    async (job) => {
      const data = job.data as ExampleBundleJobData;
      return processExampleBundleJob(data, job.id ?? undefined);
    },
    {
      connection,
      concurrency: Number.isFinite(EXAMPLE_BUNDLE_CONCURRENCY) && EXAMPLE_BUNDLE_CONCURRENCY > 0
        ? EXAMPLE_BUNDLE_CONCURRENCY
        : 1
    }
  );

  worker.on('failed', (job, err) => {
    const slug = (job?.data as ExampleBundleJobData | undefined)?.slug;
    console.error('[example-bundles] Job failed', {
      jobId: job?.id,
      slug,
      error: err instanceof Error ? err.message : String(err)
    });
  });

  worker.on('completed', (job) => {
    const slug = (job.data as ExampleBundleJobData | undefined)?.slug;
    console.log('[example-bundles] Job completed', { jobId: job.id, slug });
  });

  await worker.waitUntilReady();
  console.log('[example-bundles] Worker ready');

  const shutdown = async () => {
    console.log('[example-bundles] Shutdown signal received');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      console.error('[example-bundles] Failed to close Redis connection', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  runWorker().catch((err) => {
    console.error('[example-bundles] Worker crashed', err);
    process.exit(1);
  });
}
