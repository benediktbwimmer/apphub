import type { ServiceConfig } from '../config/serviceConfig';
import {
  DuckDbSpoolManager,
  type StagePartitionRequest,
  type StagePartitionResult
} from '../storage/spoolManager';
import { recordStagingDrop } from '../observability/metrics';

interface StagingManagerOptions {
  directory: string;
  maxDatasetBytes: number;
  maxTotalBytes: number;
  maxPendingPerDataset: number;
}

export class StagingQueueFullError extends Error {
  constructor(datasetSlug: string, capacity: number) {
    super(`staging queue for dataset '${datasetSlug}' reached capacity (${capacity})`);
    this.name = 'StagingQueueFullError';
  }
}

class DatasetQueue {
  private readonly pending: Array<{
    request: StagePartitionRequest;
    resolve: (value: StagePartitionResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  private processing = false;
  private inflight = 0;

  constructor(
    private readonly datasetSlug: string,
    private readonly spoolManager: DuckDbSpoolManager,
    private readonly options: { maxPending: number }
  ) {}

  enqueue(request: StagePartitionRequest): Promise<StagePartitionResult> {
    if (this.pending.length + this.inflight >= this.options.maxPending) {
      recordStagingDrop({ datasetSlug: this.datasetSlug, reason: 'queue_full' });
      return Promise.reject(new StagingQueueFullError(this.datasetSlug, this.options.maxPending));
    }

    return new Promise<StagePartitionResult>((resolve, reject) => {
      this.pending.push({ request, resolve, reject });
      void this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        try {
          this.inflight += 1;
          const stageResult = await this.spoolManager.stagePartition(item.request);
          item.resolve(stageResult);
        } catch (error) {
          item.reject(error);
        } finally {
          this.inflight -= 1;
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

class StagingWriteManager {
  private readonly spoolManager: DuckDbSpoolManager;
  private readonly queues = new Map<string, DatasetQueue>();
  private readonly maxPendingPerDataset: number;

  constructor(options: StagingManagerOptions) {
    this.spoolManager = new DuckDbSpoolManager({
      directory: options.directory,
      maxDatasetBytes: options.maxDatasetBytes,
      maxTotalBytes: options.maxTotalBytes
    });
    this.maxPendingPerDataset = options.maxPendingPerDataset;
  }

  enqueue(request: StagePartitionRequest): Promise<StagePartitionResult> {
    const queue = this.getOrCreateQueue(request.datasetSlug);
    return queue.enqueue(request);
  }

  async close(): Promise<void> {
    await this.spoolManager.close();
    this.queues.clear();
  }

  getSpoolManager(): DuckDbSpoolManager {
    return this.spoolManager;
  }

  private getOrCreateQueue(datasetSlug: string): DatasetQueue {
    let queue = this.queues.get(datasetSlug);
    if (!queue) {
      queue = new DatasetQueue(datasetSlug, this.spoolManager, {
        maxPending: this.maxPendingPerDataset
      });
      this.queues.set(datasetSlug, queue);
    }
    return queue;
  }
}

let activeManager: StagingWriteManager | null = null;
let activeOptionsSignature: string | null = null;

function buildOptionsSignature(options: StagingManagerOptions): string {
  return JSON.stringify({
    directory: options.directory,
    maxDatasetBytes: options.maxDatasetBytes,
    maxTotalBytes: options.maxTotalBytes,
    maxPendingPerDataset: options.maxPendingPerDataset
  });
}

function toManagerOptions(config: ServiceConfig): StagingManagerOptions {
  return {
    directory: config.staging.directory,
    maxDatasetBytes: config.staging.maxDatasetBytes,
    maxTotalBytes: config.staging.maxTotalBytes,
    maxPendingPerDataset: config.staging.maxPendingPerDataset
  } satisfies StagingManagerOptions;
}

export function getStagingWriteManager(config: ServiceConfig): StagingWriteManager {
  const options = toManagerOptions(config);
  const signature = buildOptionsSignature(options);
  if (activeManager && activeOptionsSignature === signature) {
    return activeManager;
  }
  if (activeManager) {
    void activeManager.close().catch(() => undefined);
  }
  activeManager = new StagingWriteManager(options);
  activeOptionsSignature = signature;
  return activeManager;
}

export async function resetStagingWriteManager(): Promise<void> {
  if (activeManager) {
    await activeManager.close();
    activeManager = null;
    activeOptionsSignature = null;
  }
}
