import classNames from 'classnames';
import { findMetricValue } from '../../timestore/utils';
import type { ServiceMetricSource, ServiceMetricsSnapshot } from '../types';
import { Sparkline } from './Sparkline';

const PANEL_CLASSES =
  'rounded-3xl border border-subtle bg-surface-muted p-6 shadow-elevation-lg backdrop-blur-md transition-colors flex flex-col gap-4';

const SERVICE_LABELS: Record<ServiceMetricSource, string> = {
  timestore: 'Timestore',
  metastore: 'Metastore',
  filestore: 'Filestore'
};

export function ServiceMetricsPanel({
  snapshots,
  histories
}: {
  snapshots: ServiceMetricsSnapshot[] | null;
  histories: Record<ServiceMetricSource, number[]>;
}) {
  return (
    <div className={PANEL_CLASSES}>
      <header className="flex flex-col gap-1">
        <h2 className="text-scale-base font-weight-semibold text-primary">Service telemetry</h2>
        <span className="text-scale-xs text-muted">Prometheus snapshots sampled from platform services</span>
      </header>

      <div className="flex flex-col gap-4">
        {snapshots?.map((snapshot) => {
          const { primaryLabel, primaryValue, unit, detail } = getServicePrimaryMetric(snapshot);
          const history = histories[snapshot.service] ?? [];
          return (
            <article
              key={snapshot.service}
              className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-scale-sm font-weight-semibold text-primary">
                    {SERVICE_LABELS[snapshot.service]}
                  </span>
                  <span className="text-scale-xs text-muted">{primaryLabel}</span>
                </div>
                <div className="text-right text-scale-lg font-weight-semibold text-primary">
                  {snapshot.error ? '—' : formatMetric(primaryValue, unit)}
                </div>
              </div>
              {snapshot.error ? (
                <div className="rounded-xl border border-status-warning bg-status-warning-soft px-3 py-2 text-scale-xs text-status-warning">
                  {snapshot.error}
                </div>
              ) : (
                <Sparkline data={history} height={48} />
              )}
              <span className="text-scale-xs text-muted">{detail}</span>
            </article>
          );
        }) ?? (
          <div className={classNames('flex min-h-[140px] items-center justify-center rounded-2xl border border-dashed border-subtle text-scale-sm text-muted')}>
            No service metrics available.
          </div>
        )}
      </div>
    </div>
  );
}

export function getServicePrimaryMetric(snapshot: ServiceMetricsSnapshot) {
  switch (snapshot.service) {
    case 'timestore': {
      const waiting = findMetricValue(snapshot.metrics, 'timestore_ingest_queue_jobs', { state: 'waiting' }) ?? 0;
      const latency = findMetricValue(snapshot.metrics, 'timestore_query_duration_seconds_sum') ?? 0;
      return {
        primaryLabel: 'Ingest queue waiting jobs',
        primaryValue: waiting,
        unit: 'count',
        detail: `Query latency sum (s): ${latency.toFixed(2)}`
      };
    }
    case 'metastore': {
      const lag = findMetricValue(snapshot.metrics, 'metastore_filestore_lag_seconds') ?? 0;
      const stalled = findMetricValue(snapshot.metrics, 'metastore_filestore_consumer_stalled') ?? 0;
      return {
        primaryLabel: 'Filestore consumer lag (s)',
        primaryValue: lag,
        unit: 'seconds',
        detail: stalled > 0 ? 'Consumer stalled' : 'Consumer healthy'
      };
    }
    case 'filestore':
    default: {
      const outstanding = findMetricValue(snapshot.metrics, 'filestore_reconciliation_queue_depth', { state: 'waiting' }) ?? 0;
      const httpTotal = findMetricValue(snapshot.metrics, 'filestore_http_requests_total', { method: 'GET', route: '/metrics', status: '200' }) ?? 0;
      return {
        primaryLabel: 'Reconciliation queue waiting',
        primaryValue: outstanding,
        unit: 'count',
        detail: `HTTP metrics pulls: ${httpTotal.toFixed(0)}`
      };
    }
  }
}

function formatMetric(value: number, unit: 'count' | 'seconds') {
  if (unit === 'seconds') {
    if (value >= 3600) {
      return `${(value / 3600).toFixed(1)} h`;
    }
    if (value >= 60) {
      return `${(value / 60).toFixed(1)} m`;
    }
    return `${value.toFixed(1)} s`;
  }
  return new Intl.NumberFormat().format(Math.max(value, 0));
}
