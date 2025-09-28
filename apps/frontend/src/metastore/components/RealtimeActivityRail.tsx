import { useEffect, useMemo, useRef, useState } from 'react';
import { METASTORE_BASE_URL } from '../../config';
import { useAuth } from '../../auth/useAuth';
import { Spinner } from '../../components/Spinner';
import { formatInstant } from '../utils';
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

function toneClasses(tone: StatusDescriptor['tone']): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'info':
      return 'bg-sky-500';
    case 'warn':
      return 'bg-amber-500';
    case 'error':
      return 'bg-rose-500';
    case 'neutral':
    default:
      return 'bg-slate-400';
  }
}

function describeAction(entry: MetastoreStreamEntry): { label: string; className: string } {
  const { action, mode } = entry.payload;
  switch (action) {
    case 'created':
      return { label: 'Created', className: 'text-emerald-600 dark:text-emerald-300' };
    case 'updated':
      return { label: 'Updated', className: 'text-sky-600 dark:text-sky-300' };
    case 'deleted':
      if (mode === 'hard') {
        return { label: 'Purged', className: 'text-rose-600 dark:text-rose-300' };
      }
      return { label: 'Deleted', className: 'text-amber-600 dark:text-amber-300' };
    default:
      return { label: action, className: 'text-slate-600 dark:text-slate-300' };
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
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/70">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Realtime activity</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Namespace {namespace || 'default'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <span className={`h-2.5 w-2.5 rounded-full ${toneClasses(statusDescriptor.tone)}`} />
              {statusDescriptor.label}
              {status === 'connecting' ? <Spinner size="xs" /> : null}
            </span>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={!enabled}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={handleCopyCommand}
            className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600/60 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {copied ? 'Copied curl command' : 'Copy curl command'}
          </button>
          <span className="truncate">{curlCommand}</span>
        </div>
        {copyError ? (
          <p className="text-xs text-rose-500 dark:text-rose-300">{copyError}</p>
        ) : null}
        {!enabled ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Provide a metastore access token with <code className="font-mono text-[11px]">metastore:read</code> scope to enable live
            updates.
          </p>
        ) : null}
        {error ? <p className="text-xs text-rose-500 dark:text-rose-300">{error}</p> : null}
        {paused && pendingCount > 0 ? (
          <div className="flex items-center justify-between rounded-xl border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/50 dark:bg-amber-500/10 dark:text-amber-200">
            <span>{pendingCount} new event{pendingCount === 1 ? '' : 's'} while paused</span>
            <button
              type="button"
              onClick={() => {
                setPaused(false);
                setDisplayed(relevantEvents);
              }}
              className="rounded-full border border-amber-400/60 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-400/20 dark:border-amber-300/40 dark:text-amber-200"
            >
              Catch up
            </button>
          </div>
        ) : null}
      </header>

      <section className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
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
                  className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-sm text-slate-700 transition-shadow hover:shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${action.className}`}>
                      {action.label}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Observed {formatInstant(entry.payload.occurredAt)}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {entry.payload.key}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
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
