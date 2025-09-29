import { useEffect, useState } from 'react';
import { useRuntimeScalingSettings } from './runtimeScaling/useRuntimeScalingSettings';
import type { RuntimeScalingTarget } from './runtimeScaling/types';
import { Spinner } from '../components/Spinner';

function formatInstant(value: string | null): string {
  if (!value) {
    return '—';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return value;
  }
}

function formatRateLimit(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'No rate limit enforced';
  }
  if (ms < 1_000) {
    return `${ms} ms between updates`;
  }
  const seconds = ms / 1_000;
  if (seconds < 60) {
    return `${Math.round(seconds * 10) / 10}s between updates`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${Math.round(minutes * 10) / 10}m between updates`;
  }
  const hours = minutes / 60;
  return `${Math.round(hours * 10) / 10}h between updates`;
}

function statusBadgeClasses(status: 'ok' | 'pending' | 'error'): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-50/70 text-emerald-600 border border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/40';
    case 'pending':
      return 'bg-amber-50/70 text-amber-600 border border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/40';
    case 'error':
    default:
      return 'bg-rose-50/70 text-rose-600 border border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-200 dark:border-rose-500/40';
  }
}

function differenceLabel(target: RuntimeScalingTarget): string {
  if (target.desiredConcurrency === target.effectiveConcurrency) {
    return 'Aligned';
  }
  if (target.effectiveConcurrency > target.desiredConcurrency) {
    return `+${target.effectiveConcurrency - target.desiredConcurrency}`;
  }
  return `${target.effectiveConcurrency - target.desiredConcurrency}`;
}

type DraftState = {
  desiredConcurrency: number;
  reason: string;
};

type MessageState = {
  type: 'success' | 'error';
  text: string;
};

export default function RuntimeScalingSettingsPage() {
  const { targets, writesEnabled, loading, error, updating, refresh, updateTarget } =
    useRuntimeScalingSettings();
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [messages, setMessages] = useState<Record<string, MessageState | null>>({});
  const [dirtyTargets, setDirtyTargets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const targetsToClear: string[] = [];
    setDrafts((prev) => {
      const next: Record<string, DraftState> = {};
      for (const target of targets) {
        const previous = prev[target.target];
        const reason = target.reason ?? '';
        if (dirtyTargets[target.target] && previous) {
          const clampedDesired = Math.max(
            target.minConcurrency,
            Math.min(target.maxConcurrency, previous.desiredConcurrency)
          );
          const matchesTarget =
            clampedDesired === target.desiredConcurrency && previous.reason === reason;
          if (matchesTarget) {
            targetsToClear.push(target.target);
            next[target.target] = {
              desiredConcurrency: target.desiredConcurrency,
              reason
            };
          } else {
            next[target.target] = {
              desiredConcurrency: clampedDesired,
              reason: previous.reason
            };
          }
        } else {
          next[target.target] = {
            desiredConcurrency: target.desiredConcurrency,
            reason
          };
        }
      }
      return next;
    });
    setMessages((prev) => {
      const next: Record<string, MessageState | null> = {};
      for (const target of targets) {
        next[target.target] = prev[target.target] ?? null;
      }
      return next;
    });
    const targetKeys = new Set(targets.map((entry) => entry.target));
    setDirtyTargets((prev) => {
      let mutated = false;
      const next = { ...prev };
      for (const key of targetsToClear) {
        if (next[key]) {
          mutated = true;
          delete next[key];
        }
      }
      for (const key of Object.keys(prev)) {
        if (!targetKeys.has(key)) {
          mutated = true;
          delete next[key];
        }
      }
      return mutated ? next : prev;
    });
  }, [targets, dirtyTargets]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void refresh();
    };
    const interval = window.setInterval(tick, 30000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', tick);
    }

    return () => {
      window.clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', tick);
      }
    };
  }, [refresh]);

  const handleDesiredChange = (targetKey: string, rawValue: string) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [targetKey]: {
        desiredConcurrency: Math.floor(numeric),
        reason: prev[targetKey]?.reason ?? ''
      }
    }));
    setDirtyTargets((prev) => ({ ...prev, [targetKey]: true }));
  };

  const clampDraft = (target: RuntimeScalingTarget, draft: DraftState): DraftState => {
    const clamped = Math.max(target.minConcurrency, Math.min(target.maxConcurrency, draft.desiredConcurrency));
    return {
      desiredConcurrency: clamped,
      reason: draft.reason
    };
  };

  const handleBlur = (target: RuntimeScalingTarget) => {
    setDrafts((prev) => {
      const current = prev[target.target];
      if (!current) {
        return prev;
      }
      const normalized = clampDraft(target, current);
      if (normalized.desiredConcurrency === current.desiredConcurrency) {
        return prev;
      }
      return { ...prev, [target.target]: normalized };
    });
  };

  const handleReasonChange = (targetKey: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [targetKey]: {
        desiredConcurrency: prev[targetKey]?.desiredConcurrency ?? 0,
        reason: value
      }
    }));
    setDirtyTargets((prev) => ({ ...prev, [targetKey]: true }));
  };

  const clearMessage = (targetKey: string, delayMs = 4000) => {
    window.setTimeout(() => {
      setMessages((prev) => {
        if (!prev[targetKey]) {
          return prev;
        }
        const next = { ...prev };
        next[targetKey] = null;
        return next;
      });
    }, delayMs);
  };

  const submitUpdate = async (target: RuntimeScalingTarget) => {
    const draft = drafts[target.target] ?? {
      desiredConcurrency: target.desiredConcurrency,
      reason: target.reason ?? ''
    };
    const normalizedDraft = clampDraft(target, draft);
    try {
      const result = await updateTarget(target.target, {
        desiredConcurrency: normalizedDraft.desiredConcurrency,
        reason: normalizedDraft.reason.trim() ? normalizedDraft.reason.trim() : null
      });
      setDirtyTargets((prev) => {
        const next = { ...prev };
        delete next[target.target];
        return next;
      });
      setMessages((prev) => ({
        ...prev,
        [target.target]: {
          type: 'success',
          text: `Updated desired concurrency to ${result.desiredConcurrency}.`
        }
      }));
      clearMessage(target.target);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update runtime scaling target.';
      setMessages((prev) => ({
        ...prev,
        [target.target]: {
          type: 'error',
          text: message
        }
      }));
      clearMessage(target.target, 6000);
    }
  };

  const resetDraft = (target: RuntimeScalingTarget) => {
    setDrafts((prev) => ({
      ...prev,
      [target.target]: {
        desiredConcurrency: target.defaultConcurrency,
        reason: ''
      }
    }));
    setDirtyTargets((prev) => {
      const next = { ...prev };
      delete next[target.target];
      return next;
    });
    setMessages((prev) => ({ ...prev, [target.target]: null }));
  };

  const renderTargetCard = (target: RuntimeScalingTarget) => {
    const draft = drafts[target.target] ?? {
      desiredConcurrency: target.desiredConcurrency,
      reason: target.reason ?? ''
    };
    const normalizedDraft = clampDraft(target, draft);
    const isUpdating = Boolean(updating[target.target]);
    const hasChanges =
      normalizedDraft.desiredConcurrency !== target.desiredConcurrency ||
      (normalizedDraft.reason ?? '') !== (target.reason ?? '');
    const disableActions = !writesEnabled || isUpdating || !hasChanges;
    const message = messages[target.target];

    const sortedCounts = Object.entries(target.queue.counts).filter(([, value]) => Number.isFinite(value));

    return (
      <article
        key={target.target}
        className="flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.55)] dark:border-slate-700/60 dark:bg-slate-900/60"
      >
        <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{target.displayName}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{target.description}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Queue {target.queue.name} · Mode {target.queue.mode}
              {target.queue.error ? ` · ${target.queue.error}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 text-sm text-slate-600 dark:text-slate-300 md:items-end">
            <span>
              Effective concurrency{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {target.effectiveConcurrency}
              </strong>{' '}
              ({differenceLabel(target)} vs desired)
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Updated {formatInstant(target.updatedAt)}
            </span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              Desired concurrency
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={target.minConcurrency}
                  max={target.maxConcurrency}
                  step={1}
                  value={normalizedDraft.desiredConcurrency}
                  onChange={(event) => handleDesiredChange(target.target, event.target.value)}
                  onMouseUp={() => handleBlur(target)}
                  onTouchEnd={() => handleBlur(target)}
                  disabled={!writesEnabled || isUpdating}
                  className="h-1 w-full cursor-pointer rounded-full bg-slate-200 accent-violet-600 dark:bg-slate-700"
                />
                <input
                  type="number"
                  min={target.minConcurrency}
                  max={target.maxConcurrency}
                  step={1}
                  value={normalizedDraft.desiredConcurrency}
                  onChange={(event) => handleDesiredChange(target.target, event.target.value)}
                  onBlur={() => handleBlur(target)}
                  disabled={!writesEnabled || isUpdating}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Min {target.minConcurrency} · Max {target.maxConcurrency} · Default {target.defaultConcurrency}{' '}
              (env {target.defaultEnvVar})
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{formatRateLimit(target.rateLimitMs)}</p>
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              Change reason (optional)
              <textarea
                rows={3}
                value={normalizedDraft.reason}
                onChange={(event) => handleReasonChange(target.target, event.target.value)}
                disabled={!writesEnabled || isUpdating}
                placeholder="Explain why you're adjusting this queue's concurrency"
                className="min-h-[3rem] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => submitUpdate(target)}
                disabled={disableActions}
                className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                  disableActions
                    ? 'cursor-not-allowed bg-violet-400/60'
                    : 'bg-violet-600 hover:bg-violet-700'
                }`}
              >
                {isUpdating ? 'Saving…' : 'Save update'}
              </button>
              <button
                type="button"
                onClick={() => resetDraft(target)}
                disabled={!writesEnabled || isUpdating}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Reset to default
              </button>
              {message ? (
                <span
                  className={`text-sm font-medium ${
                    message.type === 'success'
                      ? 'text-emerald-600 dark:text-emerald-300'
                      : 'text-rose-600 dark:text-rose-300'
                  }`}
                >
                  {message.text}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-sm text-slate-600 shadow-inner dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Queue metrics</h3>
            {target.queue.mode === 'inline' ? (
              <p>Queue operates in inline mode; jobs execute synchronously.</p>
            ) : sortedCounts.length === 0 ? (
              <p>No queue counts reported.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedCounts.map(([state, value]) => (
                  <span
                    key={state}
                    className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-800/70 dark:text-slate-200"
                  >
                    {state}: {value}
                  </span>
                ))}
              </div>
            )}
            {target.queue.metrics ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Avg wait {target.queue.metrics.waitingAvgMs ?? '—'} ms · Avg processing {target.queue.metrics.processingAvgMs ?? '—'} ms
              </p>
            ) : null}
            {target.queue.error ? (
              <p className="text-xs text-rose-500 dark:text-rose-300">{target.queue.error}</p>
            ) : null}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recent acknowledgements</h3>
          {target.acknowledgements.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">No worker acknowledgements recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-100/80 dark:bg-slate-800/60">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2">Instance</th>
                    <th className="px-3 py-2">Applied</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {target.acknowledgements.map((ack) => (
                    <tr key={`${ack.instanceId}-${ack.updatedAt}`} className="text-slate-600 dark:text-slate-300">
                      <td className="px-3 py-2 font-mono text-xs">{ack.instanceId}</td>
                      <td className="px-3 py-2">{ack.appliedConcurrency}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClasses(ack.status)}`}>
                          {ack.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatInstant(ack.updatedAt)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {ack.error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Runtime scaling</h1>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Monitor queue depth and concurrency across ingestion, build, and workflow workers. Updates propagate to
            running workers in near real time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/80 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {!writesEnabled ? (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Runtime scaling writes are disabled in this environment. You can still review metrics, but adjustments require
          enabling <code className="rounded bg-amber-500/20 px-1 py-0.5 text-xs">APPHUB_RUNTIME_SCALING_WRITES_ENABLED</code>.
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Spinner size="sm" /> Loading runtime scaling data…
        </div>
      ) : targets.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No runtime scaling targets are configured.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {targets.map((target) => renderTargetCard(target))}
        </div>
      )}
    </div>
  );
}
