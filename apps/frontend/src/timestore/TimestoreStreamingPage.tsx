import { useMemo } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Sparkline } from '../observability/components/Sparkline';
import { STREAMING_CONSOLE_URL } from '../config';
import { formatInstant } from './utils';
import { useStreamingStatus } from './hooks/useStreamingStatus';
import {
  BADGE_PILL,
  BADGE_PILL_ACCENT,
  BADGE_PILL_DANGER,
  BADGE_PILL_MUTED,
  BADGE_PILL_SUCCESS,
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_BANNER_WARNING,
  STATUS_MESSAGE,
  STATUS_META
} from './timestoreTokens';

const PANEL_SHADOW = 'shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]';
const CARD_SHADOW = 'shadow-[0_20px_55px_-45px_rgba(15,23,42,0.55)]';

const STATE_BADGE: Record<'disabled' | 'ready' | 'degraded' | 'unconfigured', string> = {
  disabled: BADGE_PILL_MUTED,
  ready: BADGE_PILL_SUCCESS,
  degraded: BADGE_PILL_DANGER,
  unconfigured: BADGE_PILL
};

const HOT_BUFFER_BADGE: Record<'disabled' | 'ready' | 'unavailable', string> = {
  disabled: BADGE_PILL_MUTED,
  ready: BADGE_PILL_SUCCESS,
  unavailable: BADGE_PILL_DANGER
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString();
  }
  return value.toString();
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return 'n/a';
  }
  return formatInstant(iso);
}

export default function TimestoreStreamingPage() {
  const { status, loading, error, history, refresh } = useStreamingStatus();

  const latestSample = useMemo(() => history[history.length - 1] ?? null, [history]);

  const bufferedRowsSpark = useMemo(() => history.map((sample) => sample.bufferedRows), [history]);
  const openWindowsSpark = useMemo(() => history.map((sample) => sample.openWindows), [history]);
  const hotBufferDatasetsSpark = useMemo(
    () => history.map((sample) => sample.hotBufferDatasets),
    [history]
  );

  const bufferedRowsTotal = latestSample?.bufferedRows ?? 0;
  const openWindowsTotal = latestSample?.openWindows ?? 0;
  const hotBufferDatasets = latestSample?.hotBufferDatasets ?? status?.hotBuffer.datasets ?? 0;

  const connectors = status?.batchers.connectors ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">
            Streaming
          </span>
          <h1 className="text-scale-lg font-weight-semibold text-primary">Runtime overview</h1>
          <p className={STATUS_MESSAGE}>
            Broker connectivity, micro-batcher health, and hot-buffer activity for hybrid queries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            className={SECONDARY_BUTTON_COMPACT}
            href={STREAMING_CONSOLE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Open Redpanda Console
          </a>
          <button type="button" onClick={refresh} className={PRIMARY_BUTTON}>
            <ArrowPathIcon className="h-4 w-4" aria-hidden />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW} space-y-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`${BADGE_PILL_ACCENT} text-scale-xs uppercase tracking-[0.3em]`}>
            {loading ? 'Checking status…' : status ? `Streaming ${status.state}` : 'Streaming inactive'}
          </span>
          {status?.reason ? <span className={STATUS_META}>{status.reason}</span> : null}
        </div>
        {error ? <div className={STATUS_BANNER_DANGER}>{error}</div> : null}
        {!loading && status ? (
          <div className="grid gap-4 md:grid-cols-3">
            <MetricSparklineCard
              title="Buffered rows"
              value={formatNumber(bufferedRowsTotal)}
              data={bufferedRowsSpark}
              description="Rows pending flush across streaming connectors"
            />
            <MetricSparklineCard
              title="Open windows"
              value={formatNumber(openWindowsTotal)}
              data={openWindowsSpark}
              description="Micro-batcher windows awaiting seal"
            />
            <MetricSparklineCard
              title="Hot buffer datasets"
              value={formatNumber(hotBufferDatasets)}
              data={hotBufferDatasetsSpark}
              description="Datasets retaining recent streaming rows in memory"
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW} space-y-4`}>
          <div className="flex flex-col gap-1">
            <h2 className="text-scale-base font-weight-semibold text-primary">Broker</h2>
            <p className={STATUS_MESSAGE}>
              Connectivity checks between micro-batchers and the configured streaming broker.
            </p>
          </div>
          {status ? (
            <dl className="grid grid-cols-2 gap-3 text-scale-sm text-secondary">
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Configured</dt>
                <dd className={`mt-1 inline-flex items-center gap-2 ${CARD_SURFACE_SOFT} px-3 py-1 font-weight-semibold`}>
                  {status.broker.configured ? 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Reachable</dt>
                <dd className={`mt-1 inline-flex items-center gap-2 ${CARD_SURFACE_SOFT} px-3 py-1 font-weight-semibold`}>
                  {status.broker.reachable === null
                    ? 'Unknown'
                    : status.broker.reachable
                      ? 'Yes'
                      : 'No'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Last check</dt>
                <dd className={`mt-1 ${STATUS_META}`}>{formatRelative(status.broker.lastCheckedAt)}</dd>
              </div>
              {status.broker.error ? (
                <div className="col-span-2">
                  <div className={STATUS_BANNER_WARNING}>{status.broker.error}</div>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW} space-y-4`}>
          <div className="flex flex-col gap-1">
            <h2 className="text-scale-base font-weight-semibold text-primary">Hot buffer</h2>
            <p className={STATUS_MESSAGE}>
              In-memory rows merged into hybrid queries before parquet flush completes.
            </p>
          </div>
          {status ? (
            <dl className="grid grid-cols-2 gap-3 text-scale-sm text-secondary">
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">State</dt>
                <dd className={`mt-1 inline-flex items-center gap-2 ${HOT_BUFFER_BADGE[status.hotBuffer.state]} px-3 py-1 font-weight-semibold`}>
                  {status.hotBuffer.state}
                </dd>
              </div>
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Datasets</dt>
                <dd className={`mt-1 ${STATUS_META}`}>{status.hotBuffer.datasets}</dd>
              </div>
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Last ingest</dt>
                <dd className={`mt-1 ${STATUS_META}`}>{formatRelative(status.hotBuffer.lastIngestAt)}</dd>
              </div>
              <div>
                <dt className="text-scale-xs uppercase tracking-[0.3em] text-muted">Last refresh</dt>
                <dd className={`mt-1 ${STATUS_META}`}>{formatRelative(status.hotBuffer.lastRefreshAt)}</dd>
              </div>
              {!status.hotBuffer.healthy ? (
                <div className="col-span-2">
                  <div className={STATUS_BANNER_DANGER}>Hot buffer is reporting degraded health.</div>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW}`}>
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-scale-base font-weight-semibold text-primary">Streaming connectors</h2>
            <p className={STATUS_MESSAGE}>Live view of micro-batcher consumers feeding the Timestore hot buffer.</p>
          </div>
        </header>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-subtle text-scale-sm text-secondary">
            <thead className="text-scale-xs uppercase tracking-[0.2em] text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Dataset</th>
                <th className="px-4 py-3 text-left">Topic</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-right">Buffered rows</th>
                <th className="px-4 py-3 text-right">Open windows</th>
                <th className="px-4 py-3 text-left">Last event</th>
                <th className="px-4 py-3 text-left">Last flush</th>
                <th className="px-4 py-3 text-left">Last error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {connectors.length === 0 ? (
                <tr>
                  <td colSpan={8} className={`px-4 py-6 text-center ${STATUS_MESSAGE}`}>
                    No streaming connectors configured.
                  </td>
                </tr>
              ) : (
                connectors.map((connector) => (
                  <tr key={connector.connectorId} className="hover:bg-surface-glass-soft">
                    <td className="px-4 py-3 font-weight-semibold text-primary">{connector.datasetSlug}</td>
                    <td className="px-4 py-3">{connector.topic}</td>
                    <td className="px-4 py-3">
                      <span className={`${STATE_BADGE[connector.state === 'running' ? 'ready' : 'degraded']} text-scale-xs uppercase tracking-[0.2em]`}>
                        {connector.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{connector.bufferedRows.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{connector.openWindows.toLocaleString()}</td>
                    <td className="px-4 py-3">{formatRelative(connector.lastEventTimestamp)}</td>
                    <td className="px-4 py-3">{formatRelative(connector.lastFlushAt)}</td>
                    <td className="px-4 py-3 text-danger">{connector.lastError ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface MetricSparklineCardProps {
  title: string;
  value: string;
  data: number[];
  description: string;
}

function MetricSparklineCard({ title, value, data, description }: MetricSparklineCardProps) {
  return (
    <article className={`${CARD_SURFACE} ${CARD_SHADOW} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">{title}</span>
          <p className="mt-1 text-scale-lg font-weight-semibold text-primary">{value}</p>
        </div>
        <Sparkline data={data} height={48} className="h-12 w-32" />
      </div>
      <p className={STATUS_META}>{description}</p>
    </article>
  );
}
