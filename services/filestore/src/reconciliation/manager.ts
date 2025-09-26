import type { Registry } from 'prom-client';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { withConnection, withTransaction } from '../db/client';
import { getBackendMountById } from '../db/backendMounts';
import type { ConsistencyState, NodeRecord } from '../db/nodes';
import { FilestoreError } from '../errors';
import {
  emitNodeMissingEvent,
  emitNodeReconciledEvent,
  subscribeToFilestoreEvents,
  type FilestoreEvent
} from '../events/publisher';
import {
  finalizeRollupPlan,
  ensureRollupManager
} from '../rollup/manager';
import type { AppliedRollupPlan, RollupPlan } from '../rollup/types';
import { createReconciliationMetrics, type ReconciliationMetrics } from './metrics';
import { ReconciliationQueue } from './queue';
import type {
  ReconciliationJobPayload,
  ReconciliationJobSummary,
  ReconciliationJobStatus,
  ReconciliationReason
} from './types';
import { reconcileLocal } from './strategies/local';
import { reconcileS3 } from './strategies/s3';

const DEFAULT_AUDIT_BATCH_SIZE = 100;

function buildJobId(payload: ReconciliationJobPayload): string {
  return `reconcile:${payload.backendMountId}:${payload.path}`;
}

type InitializeOptions = {
  config?: ServiceConfig;
  registry?: Registry | null;
  metricsEnabled?: boolean;
};

type ReconciliationEventPayload = {
  backendMountId: number;
  nodeId: number;
  path: string;
  kind: NodeRecord['kind'];
  state: NodeRecord['state'];
  parentId: number | null;
  version: number;
  sizeBytes: number;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  consistencyState: ConsistencyState;
  consistencyCheckedAt: string;
  lastReconciledAt: string | null;
  previousState: NodeRecord['state'] | null;
  observedAt: string;
};

type PostCommitAction = {
  plan: RollupPlan | null;
  applied: AppliedRollupPlan | null;
  event:
    | {
        type: 'filestore.node.reconciled';
        payload: ReconciliationEventPayload;
        reason: ReconciliationReason;
      }
    | {
        type: 'filestore.node.missing';
        payload: ReconciliationEventPayload;
        reason: ReconciliationReason;
      }
    | null;
};

type DriftListener = (event: FilestoreEvent) => void;

class ReconciliationManager {
  private readonly config: ServiceConfig;
  private readonly metrics: ReconciliationMetrics;
  private readonly queue: ReconciliationQueue;
  private driftUnsubscribe: (() => void) | null = null;
  private auditTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private pendingAudit = false;

  constructor(config: ServiceConfig, options: { registry?: Registry | null; metricsEnabled?: boolean }) {
    this.config = config;
    this.metrics = createReconciliationMetrics({
      enabled: options.metricsEnabled ?? config.metricsEnabled,
      registry: options.registry ?? null,
      prefix: 'filestore_'
    });

    this.queue = new ReconciliationQueue(
      {
        queueName: config.reconciliation.queueName,
        redisUrl: config.redis.url,
        inlineMode: config.redis.inline,
        metrics: this.metrics,
        keyPrefix: config.redis.keyPrefix,
        concurrency: config.reconciliation.queueConcurrency
      },
      async (payload) => {
        await this.processJob(payload);
      }
    );

    this.initializeDriftListener();
    this.initializeAuditTimer();
  }

  getConfig(): ServiceConfig {
    return this.config;
  }

  async enqueue(payload: ReconciliationJobPayload): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const normalizedPath = payload.path.trim();
    if (!normalizedPath) {
      return;
    }
    const enriched: ReconciliationJobPayload = {
      ...payload,
      path: normalizedPath
    };
    const jobId = buildJobId(enriched);
    await this.queue.enqueue(enriched, { jobId });
  }

  async shutdown(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.auditTimer) {
      clearInterval(this.auditTimer);
      this.auditTimer = null;
    }
    if (this.driftUnsubscribe) {
      this.driftUnsubscribe();
      this.driftUnsubscribe = null;
    }
    await this.queue.close();
  }

  private initializeDriftListener(): void {
    const listener: DriftListener = (event) => {
      if (event.type !== 'filestore.drift.detected') {
        return;
      }
      const data = event.data;
      void this.enqueue({
        backendMountId: data.backendMountId,
        nodeId: data.nodeId ?? null,
        path: data.path,
        reason: 'drift',
        detectChildren: true
      });
    };

    this.driftUnsubscribe = subscribeToFilestoreEvents(listener);
  }

  private initializeAuditTimer(): void {
    const interval = Math.max(0, this.config.reconciliation.auditIntervalMs);
    if (interval === 0) {
      return;
    }
    this.auditTimer = setInterval(() => {
      if (this.pendingAudit) {
        return;
      }
      this.pendingAudit = true;
      void this.enqueueAuditPass()
        .catch((err) => {
          console.error('[filestore:reconcile] audit scheduling failed', err);
        })
        .finally(() => {
          this.pendingAudit = false;
        });
    }, interval);
    if (typeof this.auditTimer.unref === 'function') {
      this.auditTimer.unref();
    }
  }

  private async enqueueAuditPass(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const batchSize = this.config.reconciliation.auditBatchSize ?? DEFAULT_AUDIT_BATCH_SIZE;
    const rows = await withConnection(async (client) =>
      client.query<{ id: number; backend_mount_id: number; path: string }>(
        `SELECT id, backend_mount_id, path
           FROM nodes
          WHERE state IN ('inconsistent', 'missing')
          ORDER BY updated_at DESC
          LIMIT $1`,
        [batchSize]
      )
    );

    for (const row of rows.rows) {
      await this.enqueue({
        backendMountId: row.backend_mount_id,
        nodeId: row.id,
        path: row.path,
        reason: 'audit'
      });
    }
  }

  private async processJob(payload: ReconciliationJobPayload): Promise<void> {
    const started = Date.now();
    try {
      const outcome = await this.executeReconciliation(payload);
      if (outcome.postCommit) {
        await this.runPostCommit(outcome.postCommit);
      }
      const durationSeconds = (Date.now() - started) / 1000;
      const outcomeLabel = outcome.status === 'skipped' ? 'skipped' : 'success';
      this.metrics.recordJobResult(outcomeLabel, payload.reason);
      this.metrics.observeDuration(outcomeLabel, payload.reason, durationSeconds);
    } catch (err) {
      const durationSeconds = (Date.now() - started) / 1000;
      this.metrics.recordJobResult('failure', payload.reason);
      this.metrics.observeDuration('failure', payload.reason, durationSeconds);
      throw err;
    }
  }

  private async executeReconciliation(
    payload: ReconciliationJobPayload
  ): Promise<{ postCommit: PostCommitAction | null; status: ReconciliationJobStatus }> {
    const summary = await withTransaction(async (client) => {
      const backend = await getBackendMountById(client, payload.backendMountId);
      if (!backend) {
        throw new FilestoreError('Backend mount not found for reconciliation job', 'BACKEND_NOT_FOUND', {
          backendMountId: payload.backendMountId,
          path: payload.path,
          reason: payload.reason
        });
      }

      let result: ReconciliationJobSummary;
      if (backend.backendKind === 'local') {
        result = await reconcileLocal(client, backend, payload);
      } else if (backend.backendKind === 's3') {
        result = await reconcileS3(client, backend, payload);
      } else {
        throw new FilestoreError('Unsupported backend kind for reconciliation', 'BACKEND_NOT_FOUND', {
          backendKind: backend.backendKind
        });
      }

      return { backend, result };
    });

    const { result, backend } = summary;

    const postCommit: PostCommitAction | null =
      result.status === 'skipped'
        ? null
        : {
            plan: result.plan ?? null,
            applied: result.appliedPlan ?? null,
            event: result.emittedEvent
              ? {
                  type: result.emittedEvent.type,
                  payload: {
                    backendMountId: backend.id,
                    nodeId: result.emittedEvent.node.id,
                    path: result.emittedEvent.node.path,
                    kind: result.emittedEvent.node.kind,
                    state: result.emittedEvent.node.state,
                    parentId: result.emittedEvent.node.parentId,
                    version: result.emittedEvent.node.version,
                    sizeBytes: result.emittedEvent.node.sizeBytes,
                    checksum: result.emittedEvent.node.checksum,
                    contentHash: result.emittedEvent.node.contentHash,
                    metadata: result.emittedEvent.node.metadata,
                    consistencyState: result.emittedEvent.node.consistencyState,
                    consistencyCheckedAt: result.emittedEvent.node.consistencyCheckedAt.toISOString(),
                    lastReconciledAt: result.emittedEvent.node.lastReconciledAt
                      ? result.emittedEvent.node.lastReconciledAt.toISOString()
                      : null,
                    previousState:
                      result.emittedEvent.type === 'filestore.node.missing'
                        ? result.emittedEvent.previousState
                        : null,
                    observedAt: new Date().toISOString()
                  },
                  reason: payload.reason
                }
              : null
          };

    return {
      postCommit,
      status: result.status
    };
  }

  private async runPostCommit(action: PostCommitAction): Promise<void> {
    if (action.plan && action.applied) {
      ensureRollupManager();
      await finalizeRollupPlan(action.plan, action.applied);
    }

    if (!action.event) {
      return;
    }

    if (action.event.type === 'filestore.node.reconciled') {
      await emitNodeReconciledEvent({
        backendMountId: action.event.payload.backendMountId,
        nodeId: action.event.payload.nodeId,
        path: action.event.payload.path,
        kind: action.event.payload.kind,
        state: action.event.payload.state,
        parentId: action.event.payload.parentId,
        version: action.event.payload.version,
        sizeBytes: action.event.payload.sizeBytes,
        checksum: action.event.payload.checksum,
        contentHash: action.event.payload.contentHash,
        metadata: action.event.payload.metadata,
        consistencyState: action.event.payload.consistencyState,
        consistencyCheckedAt: action.event.payload.consistencyCheckedAt,
        lastReconciledAt: action.event.payload.lastReconciledAt,
        previousState: null,
        reason: action.event.reason,
        observedAt: action.event.payload.observedAt
      });
      return;
    }

    if (action.event.type === 'filestore.node.missing') {
      await emitNodeMissingEvent({
        backendMountId: action.event.payload.backendMountId,
        nodeId: action.event.payload.nodeId,
        path: action.event.payload.path,
        kind: action.event.payload.kind,
        state: action.event.payload.state,
        parentId: action.event.payload.parentId,
        version: action.event.payload.version,
        sizeBytes: action.event.payload.sizeBytes,
        checksum: action.event.payload.checksum,
        contentHash: action.event.payload.contentHash,
        metadata: action.event.payload.metadata,
        consistencyState: action.event.payload.consistencyState,
        consistencyCheckedAt: action.event.payload.consistencyCheckedAt,
        lastReconciledAt: action.event.payload.lastReconciledAt,
        previousState: action.event.payload.previousState,
        reason: action.event.reason,
        observedAt: action.event.payload.observedAt
      });
    }
  }
}

let managerInstance: ReconciliationManager | null = null;

export async function initializeReconciliationManager(options: InitializeOptions = {}): Promise<ReconciliationManager>
{
  if (managerInstance) {
    return managerInstance;
  }
  const config = options.config ?? loadServiceConfig();
  managerInstance = new ReconciliationManager(config, {
    registry: options.registry ?? null,
    metricsEnabled: options.metricsEnabled ?? config.metricsEnabled
  });
  return managerInstance;
}

export function ensureReconciliationManager(): ReconciliationManager {
  if (!managerInstance) {
    void initializeReconciliationManager();
    if (!managerInstance) {
      throw new Error('Failed to initialise reconciliation manager');
    }
  }
  return managerInstance;
}

export async function shutdownReconciliationManager(): Promise<void> {
  if (!managerInstance) {
    return;
  }
  await managerInstance.shutdown();
  managerInstance = null;
}

export function resetReconciliationManagerForTests(): void {
  managerInstance = null;
}
