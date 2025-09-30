import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner } from '../components';
import { useToasts } from '../components/toast';
import {
  fetchCalibrations,
  uploadCalibration,
  fetchCalibrationPlans,
  fetchCalibrationPlanDetail,
  triggerCalibrationPlanReprocess,
  toCalibrationUploadPayload,
  toPlanReprocessPayload
} from './api';
import type {
  CalibrationSnapshot,
  CalibrationPlanRecordSummary,
  CalibrationPlanPartition,
  CalibrationReprocessPlan
} from './types';
import { computePartitionStateCounts } from './types';
import { FormActions, FormButton, FormField, FormFeedback, FormSection } from '../components/form';

const SECTION_CLASSES = 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-700 rounded-lg p-6 flex flex-col gap-4';
const SECTION_TITLE_CLASSES = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
const SUBTITLE_CLASSES = 'text-sm text-slate-600 dark:text-slate-300';
const TABLE_BASE_CLASSES = 'min-w-full divide-y divide-slate-200 dark:divide-slate-700';
const TH_CLASSES = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300';
const TD_CLASSES = 'px-3 py-2 text-sm text-slate-800 dark:text-slate-200';

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function roundTo(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

type CalibrationUploadState = {
  instrumentId: string;
  effectiveAt: string;
  createdAt: string;
  revision: string;
  offsets: string;
  scales: string;
  metadata: string;
  notes: string;
  filename: string;
  overwrite: boolean;
};

const EMPTY_UPLOAD_STATE: CalibrationUploadState = {
  instrumentId: '',
  effectiveAt: '',
  createdAt: '',
  revision: '',
  offsets: '{"temperature_c": 0, "relative_humidity_pct": 0, "pm2_5_ug_m3": 0, "battery_voltage": 0}',
  scales: '',
  metadata: '{}',
  notes: '',
  filename: '',
  overwrite: false
};

type PlanDetailState = {
  plan: CalibrationReprocessPlan;
  summary: CalibrationPlanRecordSummary;
  partitionCounts: Record<string, number>;
  artifactPath: string;
};

export default function ObservatoryOpsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();

  const [calibrations, setCalibrations] = useState<CalibrationSnapshot[]>([]);
  const [calibrationsLoading, setCalibrationsLoading] = useState<boolean>(true);
  const [calibrationsError, setCalibrationsError] = useState<string | null>(null);

  const [plans, setPlans] = useState<CalibrationPlanRecordSummary[]>([]);
  const [plansLoading, setPlansLoading] = useState<boolean>(true);
  const [plansError, setPlansError] = useState<string | null>(null);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planDetail, setPlanDetail] = useState<PlanDetailState | null>(null);
  const [planDetailError, setPlanDetailError] = useState<string | null>(null);
  const [planDetailLoading, setPlanDetailLoading] = useState<boolean>(false);

  const [selectedPartitions, setSelectedPartitions] = useState<Set<string>>(new Set());
  const [maxConcurrencyInput, setMaxConcurrencyInput] = useState<string>('');
  const [pollIntervalInput, setPollIntervalInput] = useState<string>('');
  const [runKeyInput, setRunKeyInput] = useState<string>('');
  const [triggeredByInput, setTriggeredByInput] = useState<string>('');
  const [processingPlan, setProcessingPlan] = useState<boolean>(false);

  const [uploadState, setUploadState] = useState<CalibrationUploadState>(() => {
    const now = new Date();
    const defaultEffective = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    return {
      ...EMPTY_UPLOAD_STATE,
      effectiveAt: defaultEffective,
      createdAt: defaultEffective
    };
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState<boolean>(false);

  const refreshCalibrations = useCallback(async () => {
    setCalibrationsLoading(true);
    setCalibrationsError(null);
    try {
      const data = await fetchCalibrations(authorizedFetch);
      setCalibrations(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load calibrations';
      setCalibrationsError(message);
    } finally {
      setCalibrationsLoading(false);
    }
  }, [authorizedFetch]);

  const refreshPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const data = await fetchCalibrationPlans(authorizedFetch);
      setPlans(data);
      if (data.length > 0 && !selectedPlanId) {
        setSelectedPlanId(data[0].planId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load plans';
      setPlansError(message);
    } finally {
      setPlansLoading(false);
    }
  }, [authorizedFetch, selectedPlanId]);

  useEffect(() => {
    refreshCalibrations();
    refreshPlans();
  }, [refreshCalibrations, refreshPlans]);

  useEffect(() => {
    if (!selectedPlanId) {
      setPlanDetail(null);
      setPlanDetailError(null);
      setSelectedPartitions(new Set());
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const loadDetail = async () => {
      setPlanDetailLoading(true);
      setPlanDetailError(null);
      try {
        const response = await fetchCalibrationPlanDetail(authorizedFetch, selectedPlanId);
        if (cancelled) {
          return;
        }
        setPlanDetail({
          plan: response.plan,
          summary: response.summary,
          partitionCounts: response.computed.partitionStateCounts,
          artifactPath: response.artifact.path
        });
        setPlans((current) =>
          current.map((plan) => (plan.planId === response.summary.planId ? response.summary : plan))
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load plan detail';
        setPlanDetailError(message);
      } finally {
        if (!cancelled) {
          setPlanDetailLoading(false);
          pollTimer = setTimeout(loadDetail, 5000);
        }
      }
    };

    loadDetail();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [authorizedFetch, selectedPlanId]);

  const handleUploadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError(null);
    setUploadBusy(true);

    try {
      const instrumentId = uploadState.instrumentId.trim();
      const effectiveAtInput = uploadState.effectiveAt?.trim();
      if (!instrumentId || !effectiveAtInput) {
        setUploadError('Instrument ID and effective timestamp are required.');
        setUploadBusy(false);
        return;
      }

      const effectiveAtIso = new Date(effectiveAtInput).toISOString();
      const createdAtIso = uploadState.createdAt?.trim()
        ? new Date(uploadState.createdAt).toISOString()
        : undefined;

      const revisionValue = uploadState.revision.trim() ? Number(uploadState.revision.trim()) : undefined;
      if (revisionValue !== undefined && Number.isNaN(revisionValue)) {
        setUploadError('Revision must be a number.');
        setUploadBusy(false);
        return;
      }

      const parseJsonField = (label: string, value: string) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, number>;
          }
          throw new Error(`${label} must be a JSON object.`);
        } catch (error) {
          throw new Error(
            `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      };

      let offsetsValue: Record<string, number> | undefined;
      let scalesValue: Record<string, number> | undefined;
      let metadataValue: Record<string, unknown> | undefined;

      if (uploadState.offsets.trim().length > 0) {
        offsetsValue = parseJsonField('Offsets', uploadState.offsets);
      }
      if (uploadState.scales.trim().length > 0) {
        scalesValue = parseJsonField('Scales', uploadState.scales);
      }
      if (uploadState.metadata.trim().length > 0) {
        try {
          const parsedMetadata = JSON.parse(uploadState.metadata.trim());
          if (parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata)) {
            metadataValue = parsedMetadata as Record<string, unknown>;
          } else {
            throw new Error('Metadata must be a JSON object.');
          }
        } catch (error) {
          throw new Error(
            `Metadata must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const payload = toCalibrationUploadPayload({
        instrumentId,
        effectiveAt: effectiveAtIso,
        createdAt: createdAtIso,
        revision: revisionValue ?? undefined,
        offsets: offsetsValue,
        scales: scalesValue,
        metadata: metadataValue,
        notes: uploadState.notes.trim() || undefined,
        filename: uploadState.filename.trim() || undefined,
        overwrite: uploadState.overwrite
      });

      const result = await uploadCalibration(authorizedFetch, payload);
      pushToast({
        tone: 'success',
        title: 'Calibration uploaded',
        description: `${result.instrumentId} @ ${new Date(result.effectiveAt).toLocaleString()} queued for import.`
      });
      setUploadState((state) => ({
        ...state,
        instrumentId: '',
        notes: '',
        filename: '',
        revision: '',
        offsets: state.offsets,
        scales: state.scales,
        metadata: state.metadata
      }));
      await refreshCalibrations();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload calibration file';
      setUploadError(message);
      pushToast({ tone: 'error', title: 'Upload failed', description: message });
    } finally {
      setUploadBusy(false);
    }
  };

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.planId === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const planPartitions: CalibrationPlanPartition[] = useMemo(() => {
    if (!planDetail) {
      return [];
    }
    return planDetail.plan.calibrations.flatMap((entry) => entry.partitions);
  }, [planDetail]);

  const handleTogglePartition = (partitionKey: string) => {
    setSelectedPartitions((current) => {
      const next = new Set(current);
      if (next.has(partitionKey)) {
        next.delete(partitionKey);
      } else {
        next.add(partitionKey);
      }
      return next;
    });
  };

  const resetSelection = () => {
    setSelectedPartitions(new Set());
    setMaxConcurrencyInput('');
    setPollIntervalInput('');
    setRunKeyInput('');
    setTriggeredByInput('');
  };

  const handleTriggerReprocess = async (mode: 'all' | 'selected') => {
    if (!selectedPlan || !planDetail) {
      return;
    }
    if (mode === 'selected' && selectedPartitions.size === 0) {
      pushToast({
        tone: 'warning',
        title: 'Select partitions',
        description: 'Choose at least one partition before reprocessing.'
      });
      return;
    }

    setProcessingPlan(true);
    try {
      const payload = toPlanReprocessPayload({
        mode,
        selectedPartitions: mode === 'selected' ? Array.from(selectedPartitions) : undefined,
        maxConcurrency:
          maxConcurrencyInput.trim().length > 0 ? Number(maxConcurrencyInput.trim()) : undefined,
        pollIntervalMs:
          pollIntervalInput.trim().length > 0 ? Number(pollIntervalInput.trim()) : undefined,
        runKey: runKeyInput.trim() || undefined,
        triggeredBy: triggeredByInput.trim() || undefined
      });

      const response = await triggerCalibrationPlanReprocess(
        authorizedFetch,
        selectedPlan.planId,
        payload
      );

      pushToast({
        tone: 'success',
        title: 'Reprocess started',
        description: `Workflow ${response.workflowSlug} run ${response.run.id} enqueued.`
      });
      resetSelection();
      await refreshPlans();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to trigger reprocess';
      pushToast({ tone: 'error', title: 'Reprocess failed', description: message });
    } finally {
      setProcessingPlan(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <section className={SECTION_CLASSES}>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Observatory Operations</h1>
          <p className={SUBTITLE_CLASSES}>
            Manage calibration uploads, inspect reprocessing plans, and coordinate reruns from a single
            dashboard.
          </p>
        </div>
      </section>

      <section className={SECTION_CLASSES}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={SECTION_TITLE_CLASSES}>Upload Calibration</h2>
            <p className={SUBTITLE_CLASSES}>
              Provide a JSON payload per instrument and effective timestamp. Uploads land in the configured
              calibration prefix and trigger the import workflow.
            </p>
          </div>
        </div>
        <form onSubmit={handleUploadSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Instrument ID" htmlFor="calibration-instrument" hint="Use the instrument slug referenced by ingest workflows.">
              <input
                id="calibration-instrument"
                name="instrumentId"
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.instrumentId}
                onChange={(event) => setUploadState((state) => ({ ...state, instrumentId: event.target.value }))}
              />
            </FormField>
            <FormField label="Effective at" htmlFor="calibration-effective" hint="UTC timestamp the calibration takes effect.">
              <input
                id="calibration-effective"
                name="effectiveAt"
                type="datetime-local"
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.effectiveAt}
                onChange={(event) => setUploadState((state) => ({ ...state, effectiveAt: event.target.value }))}
              />
            </FormField>
            <FormField label="Created at" htmlFor="calibration-created" hint="Optional timestamp when calibration file was produced.">
              <input
                id="calibration-created"
                name="createdAt"
                type="datetime-local"
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.createdAt}
                onChange={(event) => setUploadState((state) => ({ ...state, createdAt: event.target.value }))}
              />
            </FormField>
            <FormField label="Revision" htmlFor="calibration-revision">
              <input
                id="calibration-revision"
                name="revision"
                type="number"
                min="0"
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.revision}
                onChange={(event) => setUploadState((state) => ({ ...state, revision: event.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Offsets" htmlFor="calibration-offsets" hint="JSON object keyed by measurement field (e.g. temperature_c).">
              <textarea
                id="calibration-offsets"
                name="offsets"
                rows={4}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.offsets}
                onChange={(event) => setUploadState((state) => ({ ...state, offsets: event.target.value }))}
              />
            </FormField>
            <FormField label="Scales" htmlFor="calibration-scales" hint="Optional JSON object of multiplicative scales per measurement.">
              <textarea
                id="calibration-scales"
                name="scales"
                rows={4}
                placeholder="{}"
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.scales}
                onChange={(event) => setUploadState((state) => ({ ...state, scales: event.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Metadata" htmlFor="calibration-metadata" hint="Additional JSON metadata stored alongside the calibration record.">
              <textarea
                id="calibration-metadata"
                name="metadata"
                rows={4}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.metadata}
                onChange={(event) => setUploadState((state) => ({ ...state, metadata: event.target.value }))}
              />
            </FormField>
            <FormField label="Notes" htmlFor="calibration-notes">
              <textarea
                id="calibration-notes"
                name="notes"
                rows={4}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.notes}
                onChange={(event) => setUploadState((state) => ({ ...state, notes: event.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Filename" htmlFor="calibration-filename" hint="Optional filename override within the calibrations prefix.">
              <input
                id="calibration-filename"
                name="filename"
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                value={uploadState.filename}
                onChange={(event) => setUploadState((state) => ({ ...state, filename: event.target.value }))}
              />
            </FormField>
            <FormField>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={uploadState.overwrite}
                  onChange={(event) => setUploadState((state) => ({ ...state, overwrite: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                />
                Overwrite existing file if present
              </label>
            </FormField>
          </div>

          {uploadError && <FormFeedback tone="error">{uploadError}</FormFeedback>}

          <FormActions>
            <FormButton type="submit" tone="primary" loading={uploadBusy} disabled={uploadBusy}>
              Upload calibration
            </FormButton>
          </FormActions>
        </form>
      </section>

      <section className={SECTION_CLASSES}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={SECTION_TITLE_CLASSES}>Calibration History</h2>
            <p className={SUBTITLE_CLASSES}>
              Recent calibration snapshots pulled from the metastore. The latest row per instrument is highlighted.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            onClick={refreshCalibrations}
            disabled={calibrationsLoading}
          >
            Refresh
          </button>
        </div>
        {calibrationsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner label="Loading calibrations" />
          </div>
        ) : calibrationsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-600 dark:bg-red-800/30 dark:text-red-100">
            {calibrationsError}
          </div>
        ) : calibrations.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No calibrations found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE_BASE_CLASSES}>
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className={TH_CLASSES}>Instrument</th>
                  <th className={TH_CLASSES}>Effective at</th>
                  <th className={TH_CLASSES}>Revision</th>
                  <th className={TH_CLASSES}>Offsets</th>
                  <th className={TH_CLASSES}>Scales</th>
                  <th className={TH_CLASSES}>Metastore version</th>
                  <th className={TH_CLASSES}>Checksum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {calibrations.map((calibration) => (
                  <tr key={calibration.calibrationId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className={TD_CLASSES}>{calibration.instrumentId}</td>
                    <td className={TD_CLASSES}>{formatDate(calibration.effectiveAt)}</td>
                    <td className={TD_CLASSES}>{calibration.revision ?? '—'}</td>
                    <td className={TD_CLASSES}>
                      {Object.keys(calibration.offsets).length === 0
                        ? '—'
                        : Object.entries(calibration.offsets)
                            .map(([key, value]) => `${key}: ${roundTo(value)}`)
                            .join(', ')}
                    </td>
                    <td className={TD_CLASSES}>
                      {calibration.scales && Object.keys(calibration.scales).length > 0
                        ? Object.entries(calibration.scales)
                            .map(([key, value]) => `${key}: ${roundTo(value)}`)
                            .join(', ')
                        : '—'}
                    </td>
                    <td className={TD_CLASSES}>{calibration.metastoreVersion ?? '—'}</td>
                    <td className={`${TD_CLASSES} font-mono text-xs`}>{calibration.checksum?.slice(0, 12) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={SECTION_CLASSES}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={SECTION_TITLE_CLASSES}>Reprocessing Plans</h2>
              <p className={SUBTITLE_CLASSES}>
                Planned recalculations generated by the calibration planner. Select a plan to review partitions and
                trigger reruns.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              onClick={refreshPlans}
              disabled={plansLoading}
            >
              Refresh
            </button>
          </div>
          {plansLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner label="Loading plans" />
            </div>
          ) : plansError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-600 dark:bg-red-800/30 dark:text-red-100">
              {plansError}
            </div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">No calibration plans generated yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {plans.map((plan) => {
                const isSelected = plan.planId === selectedPlanId;
                return (
                  <li key={plan.planId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPlanId(plan.planId);
                        setSelectedPartitions(new Set());
                      }}
                      className={`w-full rounded-md border px-3 py-3 text-left text-sm transition focus:outline-none focus:ring focus:ring-sky-500/20 ${
                        isSelected
                          ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-900/30 text-slate-900 dark:text-slate-100'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">{plan.planId}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-300">
                            Updated {formatDate(plan.updatedAt)} · {plan.calibrationCount} calibrations · {plan.partitionCount}{' '}
                            partitions
                          </span>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${planStateStyles(plan.state)}`}>
                          {plan.state.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="xl:col-span-2">
          <div className={SECTION_CLASSES}>
            {planDetailLoading && !planDetail ? (
              <div className="flex items-center justify-center py-10">
                <Spinner label="Loading plan detail" />
              </div>
            ) : planDetailError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-600 dark:bg-red-800/30 dark:text-red-100">
                {planDetailError}
              </div>
            ) : !planDetail || !selectedPlan ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Select a plan to inspect affected partitions and trigger reprocessing.
              </p>
            ) : (
              <Fragment>
                <div className="flex flex-col gap-1">
                  <h2 className={SECTION_TITLE_CLASSES}>Plan {planDetail.summary.planId}</h2>
                  <p className={SUBTITLE_CLASSES}>
                    State: <span className="font-semibold">{planDetail.summary.state.replace(/_/g, ' ')}</span> · Last updated{' '}
                    {formatDate(planDetail.summary.updatedAt)} · Storage path {planDetail.artifactPath}
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(planDetail.partitionCounts).map(([state, count]) => (
                    <div
                      key={state}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2"
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-300">{state}</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{count}</p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className={TABLE_BASE_CLASSES}>
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                      <tr>
                        <th className={TH_CLASSES}>Instrument</th>
                        <th className={TH_CLASSES}>Calibration ID</th>
                        <th className={TH_CLASSES}>Effective from</th>
                        <th className={TH_CLASSES}>Partitions</th>
                        <th className={TH_CLASSES}>State counts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {planDetail.plan.calibrations.map((entry) => {
                        const counts = computePartitionStateCounts(entry.partitions);
                        return (
                          <tr key={`${entry.target.calibrationId}-${entry.effectiveFromMinute}`}>
                            <td className={TD_CLASSES}>{entry.target.instrumentId}</td>
                            <td className={`${TD_CLASSES} font-mono text-xs`}>{entry.target.calibrationId}</td>
                            <td className={TD_CLASSES}>{entry.effectiveFromMinute}</td>
                            <td className={TD_CLASSES}>{entry.partitions.length}</td>
                            <td className={`${TD_CLASSES} text-xs`}
                            >
                              {Object.entries(counts)
                                .filter(([, value]) => value > 0)
                                .map(([state, value]) => `${state}: ${value}`)
                                .join(', ') || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-md font-semibold text-slate-900 dark:text-slate-100">Partitions</h3>
                    <button
                      type="button"
                      className="text-sm text-sky-600 hover:text-sky-700 dark:text-sky-400"
                      onClick={() => setSelectedPartitions(new Set(planPartitions.map((partition) => partition.partitionKey || partition.minute)))}
                    >
                      Select all
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/50">
                        <tr>
                          <th className={TH_CLASSES}>Select</th>
                          <th className={TH_CLASSES}>Minute</th>
                          <th className={TH_CLASSES}>Instrument</th>
                          <th className={TH_CLASSES}>Status</th>
                          <th className={TH_CLASSES}>Run</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {planPartitions.map((partition) => {
                          const partitionKey = partition.partitionKey || partition.minute;
                          const isChecked = selectedPartitions.has(partitionKey);
                          return (
                            <tr key={`${partitionKey}-${partition.instrumentId}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className={TD_CLASSES}>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                                  checked={isChecked}
                                  onChange={() => handleTogglePartition(partitionKey)}
                                />
                              </td>
                              <td className={TD_CLASSES}>{partition.minute}</td>
                              <td className={TD_CLASSES}>{partition.instrumentId}</td>
                              <td className={TD_CLASSES}>{partition.status.state}</td>
                              <td className={`${TD_CLASSES} text-xs font-mono`}>
                                {partition.latestRun?.workflowRunId ?? '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <FormSection>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Max concurrency" htmlFor="plan-max-concurrency" hint="Defaults to workflow configuration if left blank.">
                      <input
                        id="plan-max-concurrency"
                        type="number"
                        min="1"
                        max="10"
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                        value={maxConcurrencyInput}
                        onChange={(event) => setMaxConcurrencyInput(event.target.value)}
                      />
                    </FormField>
                    <FormField label="Poll interval (ms)" htmlFor="plan-poll-interval" hint="Workflow default is 1500ms.">
                      <input
                        id="plan-poll-interval"
                        type="number"
                        min="250"
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                        value={pollIntervalInput}
                        onChange={(event) => setPollIntervalInput(event.target.value)}
                      />
                    </FormField>
                    <FormField label="Run key" htmlFor="plan-run-key" hint="Optional runKey override if you need deterministic retries.">
                      <input
                        id="plan-run-key"
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                        value={runKeyInput}
                        onChange={(event) => setRunKeyInput(event.target.value)}
                      />
                    </FormField>
                    <FormField label="Triggered by" htmlFor="plan-triggered-by" hint="Override the triggeredBy string recorded on the workflow run.">
                      <input
                        id="plan-triggered-by"
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring focus:ring-sky-500/20"
                        value={triggeredByInput}
                        onChange={(event) => setTriggeredByInput(event.target.value)}
                      />
                    </FormField>
                  </div>

                  <FormActions>
                    <FormButton
                      type="button"
                      tone="secondary"
                      loading={processingPlan}
                      disabled={processingPlan}
                      onClick={() => handleTriggerReprocess('selected')}
                    >
                      Process selected partitions
                    </FormButton>
                    <FormButton
                      type="button"
                      tone="primary"
                      loading={processingPlan}
                      disabled={processingPlan}
                      onClick={() => handleTriggerReprocess('all')}
                    >
                      Process entire plan
                    </FormButton>
                  </FormActions>
                </FormSection>
              </Fragment>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function planStateStyles(state: string): string {
  switch (state) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700';
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-200 dark:border-red-700';
    case 'in_progress':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-200 dark:border-sky-700';
    default:
      return 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-200 border border-slate-200 dark:border-slate-700';
  }
}
