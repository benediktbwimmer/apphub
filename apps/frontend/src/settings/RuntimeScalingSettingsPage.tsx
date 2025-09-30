import classNames from 'classnames';
import { useEffect, useState } from 'react';

import { Spinner } from '../components/Spinner';
import { getStatusToneClasses } from '../theme/statusTokens';
import {
  SETTINGS_ALERT_ERROR_CLASSES,
  SETTINGS_ALERT_WARNING_CLASSES,
  SETTINGS_CARD_CONTAINER_CLASSES,
  SETTINGS_FORM_LABEL_CLASSES,
  SETTINGS_FORM_TEXTAREA_CLASSES,
  SETTINGS_HEADER_SUBTITLE_CLASSES,
  SETTINGS_HEADER_TITLE_CLASSES,
  SETTINGS_INLINE_BADGE_CLASSES,
  SETTINGS_INPUT_NUMBER_CLASSES,
  SETTINGS_INPUT_RANGE_CLASSES,
  SETTINGS_PRIMARY_BUTTON_CLASSES,
  SETTINGS_SECONDARY_BUTTON_CLASSES,
  SETTINGS_SECTION_HELPER_CLASSES,
  SETTINGS_SECTION_SUBTITLE_CLASSES,
  SETTINGS_SECTION_TITLE_CLASSES,
  SETTINGS_TABLE_HEADER_CLASSES,
  SETTINGS_TABLE_META_TEXT_CLASSES,
  SETTINGS_TABLE_ROW_TEXT_CLASSES
} from './settingsTokens';
import type { RuntimeScalingTarget } from './runtimeScaling/types';
import { useRuntimeScalingSettings } from './runtimeScaling/useRuntimeScalingSettings';

const TARGET_CARD_CLASSES = classNames(
  SETTINGS_CARD_CONTAINER_CLASSES,
  'gap-5 rounded-3xl p-6 shadow-elevation-xl'
);

const TARGET_METRICS_CARD_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4 text-scale-sm text-secondary shadow-inner transition-colors';

const STATUS_BADGE_BASE_CLASSES =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold capitalize';

const PRIMARY_BUTTON_LARGE_CLASSES = classNames(SETTINGS_PRIMARY_BUTTON_CLASSES, 'px-4 py-2');

const SECONDARY_BUTTON_LARGE_CLASSES = classNames(SETTINGS_SECONDARY_BUTTON_CLASSES, 'px-4 py-2 text-scale-sm');

const TABLE_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm';
const TABLE_BODY_CLASSES = 'divide-y divide-subtle';
const TABLE_HEADER_CELL_CLASSES = classNames('px-3 py-2', SETTINGS_TABLE_HEADER_CLASSES);
const TABLE_ROW_CLASSES = classNames('text-scale-sm', SETTINGS_TABLE_ROW_TEXT_CLASSES);
const TABLE_CELL_CLASSES = 'px-3 py-2';
const TABLE_META_CELL_CLASSES = classNames('px-3 py-2', SETTINGS_TABLE_META_TEXT_CLASSES);

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
      return getStatusToneClasses('success');
    case 'pending':
      return getStatusToneClasses('warning');
    case 'error':
    default:
      return getStatusToneClasses('danger');
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
    // Fall back to the freshest acknowledgement when no policy timestamp is available.
    const lastUpdatedAt = target.updatedAt ?? target.acknowledgements[0]?.updatedAt ?? null;

    const sortedCounts = Object.entries(target.queue.counts).filter(([, value]) => Number.isFinite(value));

    return (
      <article key={target.target} className={TARGET_CARD_CLASSES}>
        <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className={SETTINGS_SECTION_TITLE_CLASSES}>{target.displayName}</h2>
            <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>{target.description}</p>
            <p className={SETTINGS_SECTION_HELPER_CLASSES}>
              Queue {target.queue.name} · Mode {target.queue.mode}
              {target.queue.error ? ` · ${target.queue.error}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 text-scale-sm text-secondary md:items-end">
            <span>
              Effective concurrency{' '}
              <strong className="font-weight-semibold text-primary">{target.effectiveConcurrency}</strong>{' '}
              ({differenceLabel(target)} vs desired)
            </span>
            <span className={SETTINGS_SECTION_HELPER_CLASSES}>Updated {formatInstant(lastUpdatedAt)}</span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <label className={SETTINGS_FORM_LABEL_CLASSES}>
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
                  className={classNames('w-full cursor-pointer', SETTINGS_INPUT_RANGE_CLASSES)}
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
                  className={SETTINGS_INPUT_NUMBER_CLASSES}
                />
              </div>
            </label>
            <p className={SETTINGS_SECTION_HELPER_CLASSES}>
              Min {target.minConcurrency} · Max {target.maxConcurrency} · Default {target.defaultConcurrency}{' '}
              (env {target.defaultEnvVar})
            </p>
            <p className={SETTINGS_SECTION_HELPER_CLASSES}>{formatRateLimit(target.rateLimitMs)}</p>
            <label className={SETTINGS_FORM_LABEL_CLASSES}>
              Change reason (optional)
              <textarea
                rows={3}
                value={normalizedDraft.reason}
                onChange={(event) => handleReasonChange(target.target, event.target.value)}
                disabled={!writesEnabled || isUpdating}
                placeholder="Explain why you're adjusting this queue's concurrency"
                className={SETTINGS_FORM_TEXTAREA_CLASSES}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => submitUpdate(target)}
                disabled={disableActions}
                className={PRIMARY_BUTTON_LARGE_CLASSES}
              >
                {isUpdating ? 'Saving…' : 'Save update'}
              </button>
              <button
                type="button"
                onClick={() => resetDraft(target)}
                disabled={!writesEnabled || isUpdating}
                className={SECONDARY_BUTTON_LARGE_CLASSES}
              >
                Reset to default
              </button>
              {message ? (
                <span
                  className={classNames(
                    'text-scale-sm font-weight-semibold',
                    message.type === 'success' ? 'text-status-success' : 'text-status-danger'
                  )}
                >
                  {message.text}
                </span>
              ) : null}
            </div>
          </div>

          <div className={TARGET_METRICS_CARD_CLASSES}>
            <h3 className={SETTINGS_SECTION_SUBTITLE_CLASSES}>Queue metrics</h3>
            {target.queue.mode === 'inline' ? (
              <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>
                Queue operates in inline mode; jobs execute synchronously.
              </p>
            ) : sortedCounts.length === 0 ? (
              <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>No queue counts reported.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedCounts.map(([state, value]) => (
                  <span key={state} className={classNames(SETTINGS_INLINE_BADGE_CLASSES, 'gap-1')}>
                    {state}: {value}
                  </span>
                ))}
              </div>
            )}
            {target.queue.metrics ? (
              <p className={SETTINGS_SECTION_HELPER_CLASSES}>
                Avg wait {target.queue.metrics.waitingAvgMs ?? '—'} ms · Avg processing{' '}
                {target.queue.metrics.processingAvgMs ?? '—'} ms
              </p>
            ) : null}
            {target.queue.error ? (
              <p className="text-scale-xs font-weight-semibold text-status-danger">{target.queue.error}</p>
            ) : null}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className={SETTINGS_SECTION_SUBTITLE_CLASSES}>Recent acknowledgements</h3>
          {target.acknowledgements.length === 0 ? (
            <p className={SETTINGS_SECTION_SUBTITLE_CLASSES}>No worker acknowledgements recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE_CLASSES}>
                <thead className="bg-surface-muted">
                  <tr>
                    <th className={TABLE_HEADER_CELL_CLASSES}>Instance</th>
                    <th className={TABLE_HEADER_CELL_CLASSES}>Applied</th>
                    <th className={TABLE_HEADER_CELL_CLASSES}>Status</th>
                    <th className={TABLE_HEADER_CELL_CLASSES}>Updated</th>
                    <th className={TABLE_HEADER_CELL_CLASSES}>Notes</th>
                  </tr>
                </thead>
                <tbody className={TABLE_BODY_CLASSES}>
                  {target.acknowledgements.map((ack) => (
                    <tr key={`${ack.instanceId}-${ack.updatedAt}`} className={TABLE_ROW_CLASSES}>
                      <td className={classNames(TABLE_META_CELL_CLASSES, 'font-mono')}>{ack.instanceId}</td>
                      <td className={classNames(TABLE_CELL_CLASSES, 'font-weight-semibold text-primary')}>
                        {ack.appliedConcurrency}
                      </td>
                      <td className={TABLE_CELL_CLASSES}>
                        <span className={classNames(STATUS_BADGE_BASE_CLASSES, statusBadgeClasses(ack.status))}>
                          {ack.status}
                        </span>
                      </td>
                      <td className={TABLE_META_CELL_CLASSES}>{formatInstant(ack.updatedAt)}</td>
                      <td className={TABLE_META_CELL_CLASSES}>{ack.error ?? '—'}</td>
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
          <h1 className={SETTINGS_HEADER_TITLE_CLASSES}>Runtime scaling</h1>
          <p className={classNames('max-w-2xl', SETTINGS_HEADER_SUBTITLE_CLASSES)}>
            Monitor queue depth and concurrency across ingestion, build, and workflow workers. Updates propagate to
            running workers in near real time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          className={SECONDARY_BUTTON_LARGE_CLASSES}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className={classNames(SETTINGS_ALERT_ERROR_CLASSES, 'shadow-elevation-sm font-weight-semibold')}>
          {error}
        </div>
      ) : null}

      {!writesEnabled ? (
        <div className={classNames(SETTINGS_ALERT_WARNING_CLASSES, 'shadow-elevation-sm')}>
          Runtime scaling writes are disabled in this environment. You can still review metrics, but adjustments require
          enabling{' '}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-scale-xs text-secondary">
            APPHUB_RUNTIME_SCALING_WRITES_ENABLED
          </code>
          .
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-scale-sm text-secondary">
          <Spinner size="sm" /> Loading runtime scaling data…
        </div>
      ) : targets.length === 0 ? (
        <p className="text-scale-sm text-secondary">No runtime scaling targets are configured.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {targets.map((target) => renderTargetCard(target))}
        </div>
      )}
    </div>
  );
}
