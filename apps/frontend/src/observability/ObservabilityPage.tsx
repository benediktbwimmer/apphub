import { useEffect, useMemo, useState } from 'react';
import {
  useCoreMetrics,
  useQueueHealth,
  useServiceMetrics,
  useObservabilityEvents
} from './hooks';
import type { CoreRunMetrics, ServiceMetricSource, ObservabilityEvent } from './types';
import { SummaryCards } from './components/SummaryCards';
import { QueueHealthPanel } from './components/QueueHealthPanel';
import { ServiceMetricsPanel, getServicePrimaryMetric } from './components/ServiceMetricsPanel';
import { EventStreamPanel } from './components/EventStreamPanel';
import { ActivityTimeline } from './components/ActivityTimeline';

const HISTORY_LIMIT = 60;

export default function ObservabilityPage() {
  const coreMetrics = useCoreMetrics();
  const queueHealth = useQueueHealth();
  const serviceMetrics = useServiceMetrics();
  const observabilityEvents = useObservabilityEvents();

  const [coreHistory, setCoreHistory] = useState<CoreRunMetrics[]>([]);
  const [queueWaitingHistory, setQueueWaitingHistory] = useState<number[]>([]);
  const [serviceHistories, setServiceHistories] = useState<Record<ServiceMetricSource, number[]>>({
    timestore: [],
    metastore: [],
    filestore: []
  });

  useEffect(() => {
    const metrics = coreMetrics.metrics;
    if (!metrics) {
      return;
    }
    setCoreHistory((previous) => appendHistory(previous, metrics));
  }, [coreMetrics.metrics]);

  useEffect(() => {
    const snapshot = queueHealth.snapshot;
    if (!snapshot) {
      return;
    }
    const waiting = snapshot.queues.reduce((sum, queue) => sum + (queue.counts?.waiting ?? 0), 0);
    setQueueWaitingHistory((previous) => appendNumericHistory(previous, waiting));
  }, [queueHealth.snapshot]);

  useEffect(() => {
    const snapshots = serviceMetrics.snapshots;
    if (!snapshots) {
      return;
    }
    setServiceHistories((previous) => {
      const next = { ...previous };
      for (const snapshot of snapshots) {
        if (snapshot.error) {
          continue;
        }
        const { primaryValue } = getServicePrimaryMetric(snapshot);
        next[snapshot.service] = appendNumericHistory(next[snapshot.service] ?? [], primaryValue);
      }
      return next;
    });
  }, [serviceMetrics.snapshots]);

  const eventFrequency = useMemo(() => computeEventFrequency(observabilityEvents.events), [observabilityEvents.events]);

  const loading = coreMetrics.loading || queueHealth.loading || serviceMetrics.loading;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-scale-xl font-weight-semibold text-primary">Observability</h1>
        <p className="text-scale-sm text-secondary">
          Unified health view for jobs, workflows, queues, and supporting services. Visualisations refresh automatically as
          new metrics arrive.
        </p>
        {coreMetrics.error || queueHealth.error || serviceMetrics.error ? (
          <div className="rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-xs text-status-warning">
            {coreMetrics.error ?? queueHealth.error ?? serviceMetrics.error}
          </div>
        ) : null}
      </header>

      <SummaryCards metricsHistory={coreHistory} queueWaitingHistory={queueWaitingHistory} loading={loading} />

      <ActivityTimeline history={coreHistory} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <QueueHealthPanel
          snapshot={queueHealth.snapshot}
          loading={queueHealth.loading}
          error={queueHealth.error}
          onRefresh={queueHealth.refresh}
        />
        <ServiceMetricsPanel snapshots={serviceMetrics.snapshots ?? null} histories={serviceHistories} />
      </section>

      <EventStreamPanel
        events={observabilityEvents.events}
        eventFrequency={eventFrequency}
        metastoreStreamStatus={observabilityEvents.status.metastoreStream}
      />
    </div>
  );
}

function appendHistory(history: CoreRunMetrics[], entry: CoreRunMetrics) {
  if (history.length > 0 && history[history.length - 1].generatedAt === entry.generatedAt) {
    return history;
  }
  const next = [...history, entry];
  if (next.length > HISTORY_LIMIT) {
    return next.slice(next.length - HISTORY_LIMIT);
  }
  return next;
}

function appendNumericHistory(history: number[], value: number) {
  const next = [...history, value];
  if (next.length > HISTORY_LIMIT) {
    return next.slice(next.length - HISTORY_LIMIT);
  }
  return next;
}

function computeEventFrequency(events: ObservabilityEvent[]) {
  const bucketMinutes = 2;
  const buckets = new Map<number, number>();
  for (const event of events.slice(0, 200)) {
    const date = new Date(event.occurredAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const bucketKey = Math.floor(date.getTime() / (bucketMinutes * 60_000));
    buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + 1);
  }
  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const counts = sorted.map(([, value]) => value);
  const limit = Math.min(counts.length, HISTORY_LIMIT);
  return counts.slice(counts.length - limit);
}
