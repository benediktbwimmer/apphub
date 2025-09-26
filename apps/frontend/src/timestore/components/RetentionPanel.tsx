import { useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import type { RetentionPolicy, RetentionResponse } from '../types';
import { formatInstant } from '../utils';
import { updateRetentionPolicy } from '../api';

interface RetentionPanelProps {
  datasetId: string;
  retention: RetentionResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  canEdit: boolean;
}

type EditablePolicyFields = {
  mode: string;
  maxAgeHours: string;
  maxTotalBytes: string;
  deleteGraceMinutes: string;
  coldStorageAfterHours: string;
};

function toEditableFields(retention: RetentionResponse | null): EditablePolicyFields {
  const base = retention?.policy ?? retention?.defaultPolicy ?? {};
  const rules = base.rules ?? {};
  return {
    mode: base.mode ?? 'hybrid',
    maxAgeHours: rules.maxAgeHours?.toString() ?? '',
    maxTotalBytes: rules.maxTotalBytes?.toString() ?? '',
    deleteGraceMinutes: base.deleteGraceMinutes?.toString() ?? '',
    coldStorageAfterHours: base.coldStorageAfterHours?.toString() ?? ''
  };
}

function buildPolicyPayload(fields: EditablePolicyFields): RetentionPolicy {
  const rules: { maxAgeHours?: number; maxTotalBytes?: number } = {};
  const maxAge = parseInt(fields.maxAgeHours, 10);
  if (!Number.isNaN(maxAge)) {
    rules.maxAgeHours = maxAge;
  }
  const maxBytes = parseInt(fields.maxTotalBytes, 10);
  if (!Number.isNaN(maxBytes)) {
    rules.maxTotalBytes = maxBytes;
  }
  const payload: RetentionPolicy = {
    mode: fields.mode as RetentionPolicy['mode'],
    rules
  };
  const deleteGrace = parseInt(fields.deleteGraceMinutes, 10);
  if (!Number.isNaN(deleteGrace)) {
    payload.deleteGraceMinutes = deleteGrace;
  }
  const coldStorage = parseInt(fields.coldStorageAfterHours, 10);
  if (!Number.isNaN(coldStorage)) {
    payload.coldStorageAfterHours = coldStorage;
  }
  return payload;
}

export function RetentionPanel({ datasetId, retention, loading, error, onRefresh, canEdit }: RetentionPanelProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError } = useToastHelpers();
  const [fields, setFields] = useState<EditablePolicyFields>(toEditableFields(retention));
  const [saving, setSaving] = useState(false);
  const effectivePolicy = retention?.effectivePolicy ?? null;

  useEffect(() => {
    setFields(toEditableFields(retention));
  }, [retention?.policy, retention?.defaultPolicy]);

  const handleChange = (key: keyof EditablePolicyFields) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleApplyDefault = async () => {
    if (!retention?.defaultPolicy) {
      return;
    }
    try {
      setSaving(true);
      await updateRetentionPolicy(authorizedFetch, datasetId, retention.defaultPolicy);
      showSuccess('Retention policy restored', 'Default retention policy applied.');
      onRefresh();
    } catch (err) {
      showError('Failed to apply default policy', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) {
      showError('Insufficient permissions', 'timestore:admin scope is required to edit retention policies.');
      return;
    }
    try {
      setSaving(true);
      const payload = buildPolicyPayload(fields);
      await updateRetentionPolicy(authorizedFetch, datasetId, payload);
      showSuccess('Retention policy updated', 'New retention settings saved.');
      onRefresh();
    } catch (err) {
      showError('Failed to update retention policy', err);
    } finally {
      setSaving(false);
    }
  };

  const effectiveSummary = useMemo(() => {
    if (!effectivePolicy) {
      return null;
    }
    return {
      mode: effectivePolicy.mode ?? 'hybrid',
      maxAgeHours: effectivePolicy.rules?.maxAgeHours ?? null,
      maxTotalBytes: effectivePolicy.rules?.maxTotalBytes ?? null,
      deleteGraceMinutes: effectivePolicy.deleteGraceMinutes ?? null,
      coldStorageAfterHours: effectivePolicy.coldStorageAfterHours ?? null
    };
  }, [effectivePolicy]);

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Retention</span>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Dataset retention policy</h4>
        </div>
        <button
          type="button"
          disabled={!canEdit || saving || !retention?.defaultPolicy}
          onClick={handleApplyDefault}
          className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
        >
          Apply defaults
        </button>
      </header>

      {loading ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Loading retention policy…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{error}</p>
      ) : retention ? (
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          {!canEdit && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Editing requires the <code className="font-mono">timestore:admin</code> scope.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Mode</span>
              <select
                value={fields.mode}
                onChange={handleChange('mode')}
                disabled={!canEdit || saving}
                className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              >
                <option value="hybrid">Hybrid</option>
                <option value="time">Time based</option>
                <option value="size">Size based</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Max age (hours)</span>
              <input
                type="number"
                min={1}
                value={fields.maxAgeHours}
                onChange={handleChange('maxAgeHours')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Max total bytes</span>
              <input
                type="number"
                min={1}
                value={fields.maxTotalBytes}
                onChange={handleChange('maxTotalBytes')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Delete grace (minutes)</span>
              <input
                type="number"
                min={0}
                value={fields.deleteGraceMinutes}
                onChange={handleChange('deleteGraceMinutes')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Cold storage after (hours)</span>
              <input
                type="number"
                min={1}
                value={fields.coldStorageAfterHours}
                onChange={handleChange('coldStorageAfterHours')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={!canEdit || saving}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save retention policy
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Retention policy unavailable.</p>
      )}

      {effectiveSummary && (
        <section className="mt-6 space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Effective policy</h5>
          <p>Mode: {effectiveSummary.mode}</p>
          <p>Max age: {effectiveSummary.maxAgeHours ?? 'default'} hours</p>
          <p>Max total bytes: {effectiveSummary.maxTotalBytes ?? 'default'}</p>
          <p>Delete grace: {effectiveSummary.deleteGraceMinutes ?? 'default'} minutes</p>
          <p>Cold storage: {effectiveSummary.coldStorageAfterHours ?? 'default'} hours</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Last updated {formatInstant(retention?.updatedAt ?? null)}</p>
        </section>
      )}
    </div>
  );
}
