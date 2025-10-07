import { Sparkline } from '../../observability/components/Sparkline';
import type { StreamingStatus } from '../types';
import type { StreamingMetricSample } from '../hooks/useStreamingStatus';
import {
  BADGE_PILL,
  BADGE_PILL_DANGER,
  BADGE_PILL_SUCCESS,
  CARD_SURFACE_SOFT,
  PANEL_SURFACE_LARGE,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';
import { formatInstant } from '../utils';

const PANEL_SHADOW = 'shadow-[0_25px_60px_-45px_rgba(15,23,42,0.6)]';

const CONNECTOR_BADGE: Record<'running' | 'starting' | 'stopped' | 'error', string> = {
  running: BADGE_PILL_SUCCESS,
  starting: BADGE_PILL,
  stopped: BADGE_PILL,
  error: BADGE_PILL_DANGER
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

function getRecentTimestamp(connectors: StreamingStatus['batchers']['connectors'], key: 'lastEventTimestamp' | 'lastFlushAt'): string | null {
  let latest: string | null = null;
  for (const connector of connectors) {
    const candidate = connector[key];
    if (!candidate) {
      continue;
    }
    if (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) {
      latest = candidate;
    }
  }
  return latest;
}

interface DatasetStreamingSummaryProps {
  datasetSlug: string | null;
  streamingStatus: StreamingStatus | null;
  history: StreamingMetricSample[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function DatasetStreamingSummary({
  datasetSlug,
  streamingStatus,
  history,
  loading,
  error,
  onRefresh
}: DatasetStreamingSummaryProps) {
  if (!datasetSlug || (!loading && !streamingStatus)) {
    return null;
  }

  const connectors = (streamingStatus?.batchers.connectors ?? []).filter(
    (connector) => connector.datasetSlug === datasetSlug
  );

  if (!loading && connectors.length === 0) {
    return null;
  }

  const bufferedRowsSpark = history.map((sample) => sample.perDataset[datasetSlug]?.bufferedRows ?? 0);
  const openWindowsSpark = history.map((sample) => sample.perDataset[datasetSlug]?.openWindows ?? 0);

  const latestBufferedRows = bufferedRowsSpark[bufferedRowsSpark.length - 1] ?? 0;
  const latestOpenWindows = openWindowsSpark[openWindowsSpark.length - 1] ?? 0;

  const latestEvent = getRecentTimestamp(connectors, 'lastEventTimestamp');
  const latestFlush = getRecentTimestamp(connectors, 'lastFlushAt');

  return (
    <section className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW} space-y-4`}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">
            Streaming
          </span>
          <h3 className="text-scale-base font-weight-semibold text-primary">Hot buffer & connectors</h3>
          <p className={STATUS_MESSAGE}>
            Real-time ingestion buffers for <span className="font-weight-semibold">{datasetSlug}</span>.
          </p>
        </div>
        <button type="button" onClick={onRefresh} className={SECONDARY_BUTTON_COMPACT}>
          Refresh
        </button>
      </header>

      {loading ? (
        <p className={STATUS_MESSAGE}>Loading streaming status…</p>
      ) : error ? (
        <div className={STATUS_BANNER_DANGER}>{error}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <MetricTile
            title="Buffered rows"
            value={formatNumber(latestBufferedRows)}
            data={bufferedRowsSpark}
            description="Rows awaiting flush for this dataset"
          />
          <MetricTile
            title="Open windows"
            value={formatNumber(latestOpenWindows)}
            data={openWindowsSpark}
            description="Micro-batcher windows in-flight"
          />
        </div>
      )}

      {!loading && connectors.length > 0 ? (
        <div className="rounded-2xl border border-subtle">
          <table className="w-full text-scale-sm text-secondary">
            <thead className="text-scale-xs uppercase tracking-[0.2em] text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Connector</th>
                <th className="px-4 py-3 text-left">Topic</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-right">Buffered rows</th>
                <th className="px-4 py-3 text-right">Open windows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {connectors.map((connector) => (
                <tr key={connector.connectorId} className="hover:bg-surface-glass-soft">
                  <td className="px-4 py-3 font-weight-semibold text-primary">{connector.connectorId}</td>
                  <td className="px-4 py-3">{connector.topic}</td>
                  <td className="px-4 py-3">
                    <span className={`${CONNECTOR_BADGE[connector.state]} text-scale-xs uppercase tracking-[0.2em]`}>
                      {connector.state}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{connector.bufferedRows.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{connector.openWindows.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && connectors.length > 0 ? (
        <div className={`${CARD_SURFACE_SOFT} grid gap-3 p-4 text-scale-sm text-secondary md:grid-cols-2`}>
          <div>
            <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">Last streaming event</span>
            <p className={`mt-1 ${STATUS_META}`}>{formatInstant(latestEvent)}</p>
          </div>
          <div>
            <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">Last flush</span>
            <p className={`mt-1 ${STATUS_META}`}>{formatInstant(latestFlush)}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface MetricTileProps {
  title: string;
  value: string;
  data: number[];
  description: string;
}

function MetricTile({ title, value, data, description }: MetricTileProps) {
  return (
    <article className={`${CARD_SURFACE_SOFT} flex flex-col gap-2 p-4`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">{title}</span>
          <p className="mt-1 text-scale-lg font-weight-semibold text-primary">{value}</p>
        </div>
        <Sparkline data={data} height={44} className="h-11 w-32" />
      </div>
      <p className={STATUS_META}>{description}</p>
    </article>
  );
}
