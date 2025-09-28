import { Gauge, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ register });

const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const;

const queueCountGauge = new Gauge({
  name: 'apphub_queue_jobs_total',
  help: 'BullMQ queue job counts by state',
  labelNames: ['queue', 'state']
});

const queueLatencyGauge = new Gauge({
  name: 'apphub_queue_job_latency_ms',
  help: 'BullMQ queue latency metrics',
  labelNames: ['queue', 'metric']
});

export type QueueTelemetryPayload = {
  counts?: Record<string, number>;
  metrics?: {
    processingAvgMs?: number | null;
    waitingAvgMs?: number | null;
  } | null;
};

function applyCounts(queue: string, counts: Record<string, number> | undefined): void {
  for (const state of QUEUE_STATES) {
    const value = counts?.[state] ?? 0;
    queueCountGauge.set({ queue, state }, value);
  }
}

function applyLatency(queue: string, metrics: QueueTelemetryPayload['metrics']): void {
  const processing = metrics?.processingAvgMs ?? 0;
  const waiting = metrics?.waitingAvgMs ?? 0;
  queueLatencyGauge.set({ queue, metric: 'processing_avg_ms' }, processing);
  queueLatencyGauge.set({ queue, metric: 'waiting_avg_ms' }, waiting);
}

export function handleQueueTelemetry(event: {
  type: string;
  queue: string;
  mode: 'inline' | 'queue';
  meta?: Record<string, unknown>;
}): void {
  if (event.type === 'metrics' && event.mode === 'queue') {
    const payload = event.meta as QueueTelemetryPayload | undefined;
    applyCounts(event.queue, payload?.counts);
    applyLatency(event.queue, payload?.metrics ?? null);
    return;
  }

  if (event.type === 'queue-disposed' || event.type === 'mode-change') {
    if (event.queue === '*') {
      return;
    }
    if (event.mode === 'inline') {
      applyCounts(event.queue, undefined);
      applyLatency(event.queue, null);
    }
  }
}

export function getPrometheusMetrics(): Promise<string> {
  return register.metrics();
}

export function getPrometheusContentType(): string {
  return register.contentType;
}
