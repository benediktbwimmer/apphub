import { useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import type { RetentionPolicy, RetentionResponse } from '../types';
import { formatInstant } from '../utils';
import { updateRetentionPolicy } from '../api';
import {
  FIELD_GROUP,
  FIELD_LABEL,
  INPUT,
  PANEL_SURFACE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

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
  const basePolicy = retention?.policy ?? retention?.defaultPolicy ?? null;
  const rules = basePolicy?.rules ?? {};
  return {
    mode: basePolicy?.mode ?? 'hybrid',
    maxAgeHours: rules.maxAgeHours?.toString() ?? '',
    maxTotalBytes: rules.maxTotalBytes?.toString() ?? '',
    deleteGraceMinutes: basePolicy?.deleteGraceMinutes?.toString() ?? '',
    coldStorageAfterHours: basePolicy?.coldStorageAfterHours?.toString() ?? ''
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
  }, [retention]);

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
    <div className={`${PANEL_SURFACE} shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md`}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">Retention</span>
          <h4 className="text-scale-base font-weight-semibold text-primary">Dataset retention policy</h4>
        </div>
        <button
          type="button"
          disabled={!canEdit || saving || !retention?.defaultPolicy}
          onClick={handleApplyDefault}
          className={SECONDARY_BUTTON_COMPACT}
        >
          Apply defaults
        </button>
      </header>

      {loading ? (
        <p className={`mt-4 ${STATUS_MESSAGE}`}>Loading retention policy…</p>
      ) : error ? (
        <p className={`mt-4 ${STATUS_BANNER_DANGER}`}>{error}</p>
      ) : retention ? (
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          {!canEdit && (
            <p className={STATUS_MESSAGE}>
              Editing requires the <code className="font-mono text-secondary">timestore:admin</code> scope.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={FIELD_GROUP}>
              <span className={FIELD_LABEL}>Mode</span>
              <select
                value={fields.mode}
                onChange={handleChange('mode')}
                disabled={!canEdit || saving}
                className={INPUT}
              >
                <option value="hybrid">Hybrid</option>
                <option value="time">Time based</option>
                <option value="size">Size based</option>
              </select>
            </label>
            <label className={FIELD_GROUP}>
              <span className={FIELD_LABEL}>Max age (hours)</span>
              <input
                type="number"
                min={1}
                value={fields.maxAgeHours}
                onChange={handleChange('maxAgeHours')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className={INPUT}
              />
            </label>
            <label className={FIELD_GROUP}>
              <span className={FIELD_LABEL}>Max total bytes</span>
              <input
                type="number"
                min={1}
                value={fields.maxTotalBytes}
                onChange={handleChange('maxTotalBytes')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className={INPUT}
              />
            </label>
            <label className={FIELD_GROUP}>
              <span className={FIELD_LABEL}>Delete grace (minutes)</span>
              <input
                type="number"
                min={0}
                value={fields.deleteGraceMinutes}
                onChange={handleChange('deleteGraceMinutes')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className={INPUT}
              />
            </label>
            <label className={FIELD_GROUP}>
              <span className={FIELD_LABEL}>Cold storage after (hours)</span>
              <input
                type="number"
                min={1}
                value={fields.coldStorageAfterHours}
                onChange={handleChange('coldStorageAfterHours')}
                placeholder="Leave blank for default"
                disabled={!canEdit || saving}
                className={INPUT}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={!canEdit || saving}
            className={PRIMARY_BUTTON}
          >
            Save retention policy
          </button>
        </form>
      ) : (
        <p className={`mt-4 ${STATUS_MESSAGE}`}>Retention policy unavailable.</p>
      )}

      {effectiveSummary && (
        <section className="mt-6 space-y-2 text-scale-sm text-secondary">
          <h5 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">Effective policy</h5>
          <p>Mode: {effectiveSummary.mode}</p>
          <p>Max age: {effectiveSummary.maxAgeHours ?? 'default'} hours</p>
          <p>Max total bytes: {effectiveSummary.maxTotalBytes ?? 'default'}</p>
          <p>Delete grace: {effectiveSummary.deleteGraceMinutes ?? 'default'} minutes</p>
          <p>Cold storage: {effectiveSummary.coldStorageAfterHours ?? 'default'} hours</p>
          <p className={STATUS_META}>Last updated {formatInstant(retention?.updatedAt ?? null)}</p>
        </section>
      )}
    </div>
  );
}
