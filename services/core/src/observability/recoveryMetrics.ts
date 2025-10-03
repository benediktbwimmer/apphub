import { Counter } from 'prom-client';

type AssetRecoveryEvent = 'scheduled' | 'completed' | 'failed';
export type AssetRecoveryFailureReason = 'schedule_error' | 'request_failed' | 'request_missing';

const recoveryEventCounter = new Counter({
  name: 'apphub_workflow_asset_recovery_events_total',
  help: 'Workflow asset recovery orchestration events',
  labelNames: ['event', 'reason']
});

function observe(event: AssetRecoveryEvent, reason: AssetRecoveryFailureReason | 'none' = 'none'): void {
  recoveryEventCounter.inc({ event, reason });
}

export function recordAssetRecoveryScheduled(): void {
  observe('scheduled');
}

export function recordAssetRecoveryCompleted(): void {
  observe('completed');
}

export function recordAssetRecoveryFailed(
  reason: AssetRecoveryFailureReason = 'request_failed'
): void {
  observe('failed', reason);
}
