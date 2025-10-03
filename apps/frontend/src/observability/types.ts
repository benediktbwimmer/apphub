import type { PromMetric } from '../timestore/utils';

export type CoreRunMetrics = {
  generatedAt: string;
  jobs: {
    total: number;
    statusCounts: Record<string, number>;
    averageDurationMs: number | null;
    failureRate: number;
  };
  workflows: {
    total: number;
    statusCounts: Record<string, number>;
    averageDurationMs: number | null;
    failureRate: number;
  };
  retries: {
    events: RetryBacklogSummary;
    triggers: RetryBacklogSummary;
    workflowSteps: RetryBacklogSummary;
  };
};

export type RetryBacklogSummary = {
  total: number;
  overdue: number;
  nextAttemptAt: string | null;
};

export type QueueMode = 'inline' | 'queue' | 'disabled';

export type QueueMetrics = {
  processingAvgMs?: number | null;
  waitingAvgMs?: number | null;
} | null;

export type QueueStats = {
  key: string;
  label: string;
  queueName: string;
  mode: QueueMode;
  counts?: Record<string, number>;
  metrics?: QueueMetrics;
  error?: string | null;
};

export type QueueHealthSnapshot = {
  generatedAt: string;
  inlineMode: boolean;
  queues: QueueStats[];
};

export type ServiceMetricSource = 'timestore' | 'metastore' | 'filestore';

export type ServiceMetricsSnapshot = {
  service: ServiceMetricSource;
  metrics: PromMetric[];
  fetchedAt: string | null;
  error: string | null;
};

export type ObservabilityEventKind =
  | 'workflow'
  | 'job'
  | 'queue'
  | 'asset'
  | 'metastore'
  | 'filestore'
  | 'system';

export type ObservabilityEventSeverity = 'info' | 'warning' | 'danger';

export type ObservabilityEvent = {
  id: string;
  kind: ObservabilityEventKind;
  source: string;
  occurredAt: string;
  summary: string;
  severity: ObservabilityEventSeverity;
  payload: unknown;
};
