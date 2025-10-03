import classNames from 'classnames';
import type { ObservabilityEvent } from '../types';
import { Sparkline } from './Sparkline';

const PANEL_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors flex flex-col gap-4';

export function EventStreamPanel({
  events,
  eventFrequency,
  metastoreStreamStatus
}: {
  events: ObservabilityEvent[];
  eventFrequency: number[];
  metastoreStreamStatus: { status: string; error: string | null };
}) {
  return (
    <div className={PANEL_CLASSES}>
      <header className="flex flex-col gap-1">
        <h2 className="text-scale-base font-weight-semibold text-primary">Recent platform events</h2>
        <span className="text-scale-xs text-muted">Fused feed aggregated from workflow, job, asset, metastore, and filestore signals</span>
      </header>

      <div className="rounded-2xl border border-subtle bg-surface-glass-soft p-3">
        <Sparkline data={eventFrequency} height={48} />
        <span className="mt-2 block text-scale-xxs text-muted">Event density (latest samples)</span>
      </div>

      {metastoreStreamStatus.error ? (
        <div className="rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-xs text-status-warning">
          Metastore stream error: {metastoreStreamStatus.error}
        </div>
      ) : null}

      <ul className="flex max-h-[360px] flex-col gap-3 overflow-y-auto pr-1">
        {events.slice(0, 20).map((event) => (
          <li
            key={event.id}
            className="rounded-2xl border border-subtle bg-surface-glass-soft p-3 text-scale-sm text-secondary"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={classNames(
                    'inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-scale-xxs font-weight-semibold uppercase tracking-[0.3em]',
                    severityBadgeClass(event.severity)
                  )}
                >
                  {event.kind}
                </span>
                <span className="text-scale-xs text-muted">{formatTimestamp(event.occurredAt)}</span>
              </div>
              <span className="text-scale-xxs text-muted uppercase tracking-[0.3em]">{event.source}</span>
            </div>
            <p className="mt-1 text-scale-sm text-primary">{event.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function severityBadgeClass(severity: string) {
  switch (severity) {
    case 'warning':
      return 'bg-status-warning-soft text-status-warning';
    case 'danger':
      return 'bg-status-danger-soft text-status-danger';
    case 'info':
    default:
      return 'bg-status-info-soft text-status-info';
  }
}

function formatTimestamp(value: string) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}
