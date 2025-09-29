export type RuntimeScalingQueueMetrics = {
  processingAvgMs?: number | null;
  waitingAvgMs?: number | null;
};

export type RuntimeScalingQueueSnapshot = {
  name: string;
  mode: 'inline' | 'queue';
  counts: Record<string, number>;
  metrics: RuntimeScalingQueueMetrics | null;
  error: string | null;
};

export type RuntimeScalingAcknowledgement = {
  instanceId: string;
  appliedConcurrency: number;
  status: 'ok' | 'pending' | 'error';
  error: string | null;
  updatedAt: string;
};

export type RuntimeScalingTarget = {
  target: string;
  displayName: string;
  description: string;
  desiredConcurrency: number;
  effectiveConcurrency: number;
  defaultConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  rateLimitMs: number;
  defaultEnvVar: string;
  source: 'policy' | 'default';
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByKind: 'user' | 'service' | null;
  policyMetadata: unknown | null;
  queue: RuntimeScalingQueueSnapshot;
  acknowledgements: RuntimeScalingAcknowledgement[];
};

export type RuntimeScalingOverview = {
  targets: RuntimeScalingTarget[];
  writesEnabled: boolean;
};

export type RuntimeScalingUpdateInput = {
  desiredConcurrency: number;
  reason: string | null;
};
