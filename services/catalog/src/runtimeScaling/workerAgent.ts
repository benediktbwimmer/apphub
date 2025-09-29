import os from 'node:os';
import { recordRuntimeScalingAcknowledgement } from '../db/runtimeScaling';
import { resolveRuntimeScalingSnapshot, type RuntimeScalingSnapshot } from './policies';
import {
  publishRuntimeScalingSyncRequest,
  subscribeToRuntimeScalingUpdates,
  type RuntimeScalingMessage
} from './notifications';
import type { RuntimeScalingTargetKey } from './targets';

type ApplyConcurrency = (concurrency: number, snapshot: RuntimeScalingSnapshot) => Promise<void> | void;

export type RuntimeScalingWorkerAgentOptions = {
  target: RuntimeScalingTargetKey;
  applyConcurrency: ApplyConcurrency;
  getCurrentConcurrency?: () => number;
  onSnapshotApplied?: (snapshot: RuntimeScalingSnapshot) => void;
};

const INSTANCE_ID = `${os.hostname()}#${process.pid}`;

export class RuntimeScalingWorkerAgent {
  private readonly target: RuntimeScalingTargetKey;
  private readonly applyConcurrency: ApplyConcurrency;
  private readonly getCurrentConcurrency?: () => number;
  private readonly onSnapshotApplied?: (snapshot: RuntimeScalingSnapshot) => void;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private refreshing = false;
  private pendingRefresh = false;

  constructor(options: RuntimeScalingWorkerAgentOptions) {
    this.target = options.target;
    this.applyConcurrency = options.applyConcurrency;
    this.getCurrentConcurrency = options.getCurrentConcurrency;
    this.onSnapshotApplied = options.onSnapshotApplied;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.refresh('startup');
    const unsubscribe = await subscribeToRuntimeScalingUpdates((message) => {
      this.handleMessage(message).catch((err) => {
        console.error('[runtime-scaling] worker listener error', err);
      });
    });
    this.unsubscribe = unsubscribe;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async handleMessage(message: RuntimeScalingMessage): Promise<void> {
    if (!this.running) {
      return;
    }
    if (message.type === 'policy:update') {
      if (message.target !== this.target) {
        return;
      }
      await this.refresh('notification');
      return;
    }
    if (message.type === 'policy:sync-request') {
      if (message.target && message.target !== this.target) {
        return;
      }
      await this.refresh('sync-request');
    }
  }

  private async refresh(reason: 'startup' | 'notification' | 'sync-request'): Promise<void> {
    if (!this.running) {
      return;
    }
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    this.pendingRefresh = false;
    try {
      const snapshot = await resolveRuntimeScalingSnapshot(this.target);
      const concurrency = snapshot.effectiveConcurrency;
      await this.applyConcurrency(concurrency, snapshot);
      await recordRuntimeScalingAcknowledgement({
        target: this.target,
        instanceId: INSTANCE_ID,
        appliedConcurrency: concurrency,
        status: 'ok',
        error: null
      });
      this.onSnapshotApplied?.(snapshot);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[runtime-scaling] failed to apply policy', {
        target: this.target,
        reason,
        error: error.message
      });
      const fallback = this.getCurrentConcurrency?.() ?? 0;
      await recordRuntimeScalingAcknowledgement({
        target: this.target,
        instanceId: INSTANCE_ID,
        appliedConcurrency: fallback,
        status: 'error',
        error: error.message
      }).catch(() => undefined);
    } finally {
      this.refreshing = false;
      if (this.pendingRefresh) {
        setImmediate(() => {
          void this.refresh('notification');
        });
      }
    }
  }

  async requestSync(): Promise<void> {
    await publishRuntimeScalingSyncRequest({ type: 'policy:sync-request', target: this.target });
  }
}

export function createRuntimeScalingWorkerAgent(options: RuntimeScalingWorkerAgentOptions): RuntimeScalingWorkerAgent {
  return new RuntimeScalingWorkerAgent(options);
}
