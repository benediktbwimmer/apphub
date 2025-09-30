import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'react';
import { METASTORE_BASE_URL } from '../../config';
import { useAuth } from '../../auth/useAuth';
import { Spinner } from '../../components/Spinner';
import { formatInstant } from '../utils';
import {
  METASTORE_ALERT_WARNING_CLASSES,
  METASTORE_CARD_CONTAINER_CLASSES,
  METASTORE_ERROR_TEXT_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_STATUS_DOT_CLASSES,
  METASTORE_STATUS_ROW_TEXT_CLASSES,
  METASTORE_STATUS_TONE_CLASSES
} from '../metastoreTokens';
import {
  useMetastoreRecordStream,
  type MetastoreStreamEntry,
  type MetastoreStreamStatus
} from '../useRecordStream';

type RealtimeActivityRailProps = {
  namespace: string;
  enabled: boolean;
};

type StatusDescriptor = {
  label: string;
  tone: 'success' | 'info' | 'warn' | 'error' | 'neutral';
};

function describeStatus(status: MetastoreStreamStatus): StatusDescriptor {
  switch (status) {
    case 'open':
      return { label: 'Live', tone: 'success' } satisfies StatusDescriptor;
    case 'connecting':
      return { label: 'Connecting…', tone: 'info' } satisfies StatusDescriptor;
    case 'reconnecting':
      return { label: 'Reconnecting…', tone: 'warn' } satisfies StatusDescriptor;
    case 'error':
      return { label: 'Disconnected', tone: 'error' } satisfies StatusDescriptor;
    case 'idle':
    default:
      return { label: 'Idle', tone: 'neutral' } satisfies StatusDescriptor;
  }
}

function describeAction(entry: MetastoreStreamEntry): { label: string; tone: StatusDescriptor['tone'] } {
  const { action, mode } = entry.payload;
  switch (action) {
    case 'created':
      return { label: 'Created', tone: 'success' };
    case 'updated':
      return { label: 'Updated', tone: 'info' };
    case 'deleted':
      if (mode === 'hard') {
        return { label: 'Purged', tone: 'error' };
      }
      return { label: 'Deleted', tone: 'warn' };
    default:
      return { label: action, tone: 'neutral' };
  }
}

function buildEventKey(entry: MetastoreStreamEntry): string {
  return (
    entry.id ?? `${entry.receivedAt}-${entry.payload.namespace}-${entry.payload.key}-${entry.payload.version ?? 'n/a'}`
  );
}

export function RealtimeActivityRail({ namespace, enabled }: RealtimeActivityRailProps) {
  const { activeToken } = useAuth();
  const { events, status, error } = useMetastoreRecordStream({ enabled });

  const [paused, setPaused] = useState(false);
  const [displayed, setDisplayed] = useState<MetastoreStreamEntry[]>([]);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamEndpoint = useMemo(
    () => `${METASTORE_BASE_URL.replace(/\/$/, '')}/stream/records`,
    []
  );

  const curlCommand = useMemo(() => {
    if (activeToken) {
      return `curl -H "Authorization: Bearer ${activeToken}" "${streamEndpoint}"`;
    }
    return `curl "${streamEndpoint}"`;
  }, [activeToken, streamEndpoint]);

  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [curlCommand]);

  const relevantEvents = useMemo(
    () => events.filter((event) => event.payload.namespace === namespace),
    [events, namespace]
  );

  useEffect(() => {
    setPaused(false);
    setDisplayed(relevantEvents);
  }, [namespace]);

  useEffect(() => {
    if (!paused) {
      setDisplayed(relevantEvents);
    }
  }, [relevantEvents, paused]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, []);

  const pendingCount = useMemo(() => {
    if (!paused) {
      return 0;
    }
    const displayedKeys = new Set(displayed.map(buildEventKey));
    let count = 0;
    for (const event of relevantEvents) {
      const key = buildEventKey(event);
      if (!displayedKeys.has(key)) {
        count += 1;
      }
    }
    return count;
  }, [paused, displayed, relevantEvents]);

  const handleCopyCommand = async () => {
    setCopyError(null);
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyError('Clipboard access is not available in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = setTimeout(() => {
        setCopied(false);
        copyResetTimer.current = null;
      }, 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy command');
    }
  };

  const statusDescriptor = describeStatus(status);
  const entries = displayed.slice(0, 30);

  return (
    <aside className={classNames('flex w-full shrink-0 flex-col gap-4 p-5', METASTORE_CARD_CONTAINER_CLASSES)}>
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-scale-sm font-weight-semibold text-primary">Realtime activity</h2>
            <span className={METASTORE_META_TEXT_CLASSES}>
              Namespace {namespace || 'default'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-scale-xs font-weight-semibold text-secondary">
              <span
                className={classNames('h-2.5 w-2.5 rounded-full', METASTORE_STATUS_DOT_CLASSES[statusDescriptor.tone])}
              />
              {statusDescriptor.label}
              {status === 'connecting' ? <Spinner size="xs" /> : null}
            </span>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
              disabled={!enabled}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
        <div className={classNames('flex flex-wrap items-center gap-2', METASTORE_META_TEXT_CLASSES)}>
          <button
            type="button"
            onClick={handleCopyCommand}
            className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
          >
            {copied ? 'Copied curl command' : 'Copy curl command'}
          </button>
          <span className="truncate">{curlCommand}</span>
        </div>
        {copyError ? <p className={METASTORE_ERROR_TEXT_CLASSES}>{copyError}</p> : null}
        {!enabled ? (
          <p className={METASTORE_META_TEXT_CLASSES}>
            Provide a metastore access token with <code className="font-mono text-[11px]">metastore:read</code> scope to enable live
            updates.
          </p>
        ) : null}
        {error ? <p className={METASTORE_ERROR_TEXT_CLASSES}>{error}</p> : null}
        {paused && pendingCount > 0 ? (
          <div className={classNames('flex items-center justify-between gap-3', METASTORE_ALERT_WARNING_CLASSES)}>
            <span>{pendingCount} new event{pendingCount === 1 ? '' : 's'} while paused</span>
            <button
              type="button"
              onClick={() => {
                setPaused(false);
                setDisplayed(relevantEvents);
              }}
              className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
            >
              Catch up
            </button>
          </div>
        ) : null}
      </header>

      <section className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className={classNames('text-scale-sm', METASTORE_META_TEXT_CLASSES)}>
            {status === 'open'
              ? 'Awaiting activity for this namespace…'
              : 'No recent activity recorded.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => {
              const action = describeAction(entry);
              return (
                <li
                  key={buildEventKey(entry)}
                  className={classNames(
                    'rounded-2xl border p-4 text-scale-sm transition-shadow hover:shadow-sm',
                    METASTORE_STATUS_TONE_CLASSES[action.tone]
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.25em]">
                      {action.label}
                    </span>
                    <span className={METASTORE_META_TEXT_CLASSES}>
                      Observed {formatInstant(entry.payload.occurredAt)}
                    </span>
                  </div>
                  <div className="mt-2 text-scale-sm font-weight-semibold text-primary">
                    {entry.payload.key}
                  </div>
                  <div className={classNames('mt-1 flex flex-wrap items-center gap-3', METASTORE_STATUS_ROW_TEXT_CLASSES)}>
                    <span>Version {entry.payload.version ?? '—'}</span>
                    <span>Actor {entry.payload.actor ?? 'system'}</span>
                    {entry.payload.deletedAt ? (
                      <span>Deleted {formatInstant(entry.payload.deletedAt)}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
