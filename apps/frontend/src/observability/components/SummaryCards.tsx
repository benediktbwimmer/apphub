import { useMemo } from 'react';
import { Sparkline } from './Sparkline';
import type { CoreRunMetrics } from '../types';

const CARD_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-5 shadow-elevation-xl backdrop-blur-md transition-colors flex flex-col gap-3';

export function SummaryCards({
  metricsHistory,
  queueWaitingHistory,
  loading
}: {
  metricsHistory: CoreRunMetrics[];
  queueWaitingHistory: number[];
  loading: boolean;
}) {
  const latestMetrics = metricsHistory.at(-1) ?? null;

  const jobTotals = useMemo(() => metricsHistory.map((entry) => entry.jobs.total), [metricsHistory]);
  const workflowFailureRates = useMemo(
    () => metricsHistory.map((entry) => entry.workflows.failureRate * 100),
    [metricsHistory]
  );
  const retryBacklogHistory = useMemo(
    () =>
      metricsHistory.map(
        (entry) => entry.retries.events.total + entry.retries.triggers.total + entry.retries.workflowSteps.total
      ),
    [metricsHistory]
  );
  const latestWaiting = queueWaitingHistory.at(-1) ?? 0;

  const cards = [
    {
      title: 'Total jobs',
      primary: latestMetrics ? formatNumber(latestMetrics.jobs.total) : loading ? 'Loading…' : '—',
      secondary: 'Jobs recorded across all queues',
      sparkline: jobTotals
    },
    {
      title: 'Workflow failure rate',
      primary: latestMetrics ? `${(latestMetrics.workflows.failureRate * 100).toFixed(1)}%` : loading ? 'Loading…' : '—',
      secondary: 'Latest computed failure percentage',
      sparkline: workflowFailureRates
    },
    {
      title: 'Retry backlog',
      primary: latestMetrics
        ? formatNumber(
            latestMetrics.retries.events.total +
              latestMetrics.retries.triggers.total +
              latestMetrics.retries.workflowSteps.total
          )
        : loading
          ? 'Loading…'
          : '—',
      secondary: 'Events, triggers, and workflow steps waiting to retry',
      sparkline: retryBacklogHistory
    },
    {
      title: 'Waiting jobs',
      primary: queueWaitingHistory.length > 0 ? formatNumber(latestWaiting) : loading ? 'Loading…' : '—',
      secondary: 'Queued workloads awaiting workers',
      sparkline: queueWaitingHistory
    }
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article key={card.title} className={CARD_CLASSES}>
          <div className="flex flex-col gap-1">
            <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent-soft">
              {card.title}
            </span>
            <span className="text-scale-lg font-weight-semibold text-primary">{card.primary}</span>
            <span className="text-scale-xs text-muted">{card.secondary}</span>
          </div>
          <Sparkline data={card.sparkline} className="mt-auto" />
        </article>
      ))}
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
