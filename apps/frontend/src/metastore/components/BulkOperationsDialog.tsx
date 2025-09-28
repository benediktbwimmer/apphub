import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import { useToastHelpers } from '../../components/toast';
import {
  buildBulkPayloadFromRows,
  parseBulkCsvInput,
  parseBulkJsonInput,
  parseBulkJsonlInput,
  stringifyBulkPayload,
  type BulkDraftRow,
  type BulkValidationResult
} from '../bulkOperations';
import type { BulkRequestPayload, BulkResponsePayload } from '../types';

interface BulkOperationsDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: BulkRequestPayload) => Promise<BulkResponsePayload>;
}

type BulkStudioStep = 'input' | 'validation' | 'confirm' | 'results';
type BulkStudioMode = 'guided' | 'raw';
type GuidedFormat = 'csv' | 'jsonl';
type OperationResult = BulkResponsePayload['operations'][number];
type ResultSortKey = 'namespace' | 'key';
type ResultSortDirection = 'asc' | 'desc';

const STEP_ORDER: Array<{ id: BulkStudioStep; label: string }> = [
  { id: 'input', label: 'Author' },
  { id: 'validation', label: 'Validate' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'results', label: 'Results' }
];

const CSV_TEMPLATE = [
  'type,namespace,key,metadata,tags,owner,schemaHash,expectedVersion',
  'upsert,default,analytics.dashboard,"{""displayName"":""Executive KPI"",""tier"":""bronze""}",dashboards|kpi,data-team,,1',
  'delete,default,legacy.dataset,,,,,'
].join('\n');

const JSONL_TEMPLATE = [
  JSON.stringify({
    type: 'upsert',
    namespace: 'default',
    key: 'analytics.dashboard',
    metadata: { displayName: 'Executive KPI', tier: 'bronze' },
    tags: ['dashboards', 'kpi']
  }),
  JSON.stringify({
    type: 'delete',
    namespace: 'default',
    key: 'legacy.dataset'
  })
].join('\n');

const RAW_JSON_TEMPLATE = JSON.stringify(
  {
    operations: [
      {
        type: 'upsert',
        namespace: 'default',
        key: 'analytics.dashboard',
        metadata: { displayName: 'Executive KPI', tier: 'bronze' },
        tags: ['dashboards', 'kpi']
      },
      {
        type: 'delete',
        namespace: 'default',
        key: 'legacy.dataset'
      }
    ]
  },
  null,
  2
);

export function BulkOperationsDialog({ open, onClose, onSubmit }: BulkOperationsDialogProps) {
  const { showError, showSuccess } = useToastHelpers();
  const [step, setStep] = useState<BulkStudioStep>('input');
  const [mode, setMode] = useState<BulkStudioMode>('guided');
  const [guidedFormat, setGuidedFormat] = useState<GuidedFormat>('csv');
  const [guidedInput, setGuidedInput] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<BulkValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [continueOnError, setContinueOnError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResponsePayload | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyError, setCopyError] = useState<string | null>(null);
  const [lastSubmittedRows, setLastSubmittedRows] = useState<BulkDraftRow[] | null>(null);
  const [resultsSortKey, setResultsSortKey] = useState<ResultSortKey>('namespace');
  const [resultsSortDirection, setResultsSortDirection] = useState<ResultSortDirection>('asc');
  const dialogTitleId = 'bulk-operations-dialog-title';
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (copyState === 'copied') {
      const timer = window.setTimeout(() => setCopyState('idle'), 2000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [copyState]);

  const validatedJson = useMemo(() => {
    if (!validationResult) {
      return null;
    }
    return stringifyBulkPayload(validationResult.rows, continueOnError);
  }, [validationResult, continueOnError]);

  const typeSummary = useMemo(() => {
    if (!validationResult) {
      return { upsert: 0, delete: 0 };
    }
    return validationResult.validRows.reduce(
      (summary, row) => {
        if (row.operation?.type === 'upsert') {
          summary.upsert += 1;
        }
        if (row.operation?.type === 'delete') {
          summary.delete += 1;
        }
        return summary;
      },
      { upsert: 0, delete: 0 }
    );
  }, [validationResult]);

  const successOperations = useMemo(() => (result ? result.operations.filter((entry) => entry.status === 'ok') : []), [result]);
  const errorOperations = useMemo(() => (result ? result.operations.filter((entry) => entry.status === 'error') : []), [result]);

  const sortedSuccesses = useMemo(
    () => sortOperationResults(successOperations, resultsSortKey, resultsSortDirection),
    [successOperations, resultsSortKey, resultsSortDirection]
  );
  const sortedFailures = useMemo(
    () => sortOperationResults(errorOperations, resultsSortKey, resultsSortDirection),
    [errorOperations, resultsSortKey, resultsSortDirection]
  );

  const currentStepIndex = STEP_ORDER.findIndex((entry) => entry.id === step);

  const resetState = () => {
    setStep('input');
    setMode('guided');
    setGuidedFormat('csv');
    setGuidedInput('');
    setRawInput('');
    setFileName(null);
    setValidationResult(null);
    setValidationError(null);
    setContinueOnError(false);
    setSubmitting(false);
    setResult(null);
    setGlobalError(null);
    setCopyState('idle');
    setCopyError(null);
    setLastSubmittedRows(null);
    setResultsSortKey('namespace');
    setResultsSortDirection('asc');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) {
      return;
    }
    try {
      const content = await selected.text();
      setGuidedInput(content);
      const name = selected.name;
      setFileName(name);
      if (name.endsWith('.jsonl')) {
        setGuidedFormat('jsonl');
      }
      if (name.endsWith('.csv')) {
        setGuidedFormat('csv');
      }
      setValidationError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read file';
      setValidationError(message);
    }
  };

  const handleValidate = () => {
    try {
      const parsed = mode === 'raw' ? parseBulkJsonInput(rawInput) : guidedFormat === 'csv' ? parseBulkCsvInput(guidedInput) : parseBulkJsonlInput(guidedInput);
      setValidationResult(parsed);
      setValidationError(null);
      setGlobalError(null);
      if (parsed.suggestedContinueOnError !== undefined) {
        setContinueOnError(parsed.suggestedContinueOnError);
      }
      setStep('validation');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse bulk operations';
      setValidationError(message);
      setValidationResult(null);
      setStep('input');
    }
  };

  const handleSubmit = async () => {
    if (!validationResult) {
      return;
    }
    const payload = buildBulkPayloadFromRows(validationResult.rows, continueOnError);
    if (!payload) {
      setGlobalError('Resolve validation errors before submitting.');
      return;
    }

    setSubmitting(true);
    setGlobalError(null);

    try {
      const response = await onSubmit(payload);
      setResult(response);
      setLastSubmittedRows(validationResult.rows);
      setStep('results');
      showSuccess('Bulk operations submitted', `${response.operations.length} operations processed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit bulk operations';
      setGlobalError(message);
      showError('Bulk operations failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyValidated = async () => {
    if (!validatedJson) {
      return;
    }
    if (!navigator.clipboard) {
      setCopyState('error');
      setCopyError('Clipboard access is not available in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(validatedJson);
      setCopyState('copied');
      setCopyError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to copy JSON payload';
      setCopyState('error');
      setCopyError(message);
    }
  };

  const handleDownloadValidated = () => {
    if (!validatedJson) {
      return;
    }
    const targetFormat = mode === 'raw' ? 'json' : guidedFormat;
    downloadJson(`metastore-bulk-${targetFormat}.json`, validatedJson);
  };

  const handleDownloadFailures = () => {
    if (!result) {
      return;
    }
    const failures = result.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.status === 'error')
      .map(({ operation, index }) => ({
        index,
        namespace: operation.namespace ?? null,
        key: operation.key ?? null,
        error: operation.error ?? null
      }));
    if (failures.length === 0) {
      return;
    }
    downloadJson('metastore-bulk-failures.json', JSON.stringify({ failures }, null, 2));
  };

  const handleRetryFailures = () => {
    if (!result || !lastSubmittedRows) {
      return;
    }
    const failedIndexes = result.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.status === 'error')
      .map(({ index }) => index);

    const failedRows = failedIndexes
      .map((index) => lastSubmittedRows[index])
      .filter((row): row is BulkDraftRow => Boolean(row && row.operation));

    if (failedRows.length === 0) {
      setGlobalError('No failed operations available to retry.');
      return;
    }

    const retryJson = JSON.stringify(
      {
        operations: failedRows.map((row) => row.operation)
      },
      null,
      2
    );

    setMode('raw');
    setRawInput(retryJson);
    setGuidedInput('');
    setFileName(null);
    setValidationResult(null);
    setValidationError(null);
    setResult(null);
    setStep('input');
    setGlobalError(null);
    setContinueOnError(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy={dialogTitleId}
      className="items-start justify-center px-4 py-6 sm:items-center"
      contentClassName="w-full max-w-4xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/60 dark:bg-slate-900/80"
    >
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={dialogTitleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Metastore bulk operations studio
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Import CSV or JSONL data, validate it against metastore schemas, then submit with per-operation previews.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border border-slate-300/70 px-3 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
            >
              Close
            </button>
          </div>
          <ol className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            {STEP_ORDER.map((entry, index) => {
              const isActive = index === currentStepIndex;
              const isCompleted = index < currentStepIndex;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                    isActive
                      ? 'border-violet-500 text-violet-600 dark:border-violet-500 dark:text-violet-300'
                      : isCompleted
                      ? 'border-emerald-500 text-emerald-600 dark:border-emerald-500 dark:text-emerald-300'
                      : 'border-slate-300/70 text-slate-500 dark:border-slate-700/70 dark:text-slate-400'
                  }`}
                >
                  <span className="font-mono text-[0.65rem]">{index + 1}</span>
                  <span>{entry.label}</span>
                </li>
              );
            })}
          </ol>
        </header>

        {step === 'input' && (
          <section className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('guided')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  mode === 'guided'
                    ? 'bg-violet-600 text-white shadow'
                    : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300'
                }`}
              >
                Guided import
              </button>
              <button
                type="button"
                onClick={() => setMode('raw')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  mode === 'raw'
                    ? 'bg-violet-600 text-white shadow'
                    : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300'
                }`}
              >
                Raw JSON
              </button>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                Need a refresher?{' '}
                <a
                  className="font-semibold text-violet-600 underline decoration-dotted hover:decoration-solid dark:text-violet-300"
                  href="https://github.com/apphub/apphub/blob/main/docs/metastore.md#post-records-bulk"
                  target="_blank"
                  rel="noreferrer"
                >
                  Bulk operations docs
                </a>
              </span>
            </div>

            {mode === 'guided' ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    Source format
                  </span>
                  <div className="flex overflow-hidden rounded-full border border-slate-300/70 dark:border-slate-700/70">
                    <button
                      type="button"
                      onClick={() => setGuidedFormat('csv')}
                      className={`px-4 py-1 text-sm font-semibold transition-colors ${
                        guidedFormat === 'csv'
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300'
                      }`}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuidedFormat('jsonl')}
                      className={`px-4 py-1 text-sm font-semibold transition-colors ${
                        guidedFormat === 'jsonl'
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300'
                      }`}
                    >
                      JSONL
                    </button>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={guidedFormat === 'csv' ? '.csv,.txt' : '.jsonl,.txt,.json'}
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                    >
                      Upload file…
                    </button>
                    {fileName && <span className="text-xs text-slate-500 dark:text-slate-400">{fileName}</span>}
                  </div>
                </div>
                <textarea
                  value={guidedInput}
                  onChange={(event) => setGuidedInput(event.target.value)}
                  rows={12}
                  placeholder={guidedFormat === 'csv' ? CSV_TEMPLATE : JSONL_TEMPLATE}
                  aria-label={guidedFormat === 'csv' ? 'Bulk operations CSV input' : 'Bulk operations JSONL input'}
                  className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 font-mono text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    Templates
                  </span>
                  <button
                    type="button"
                    onClick={() => setGuidedInput(CSV_TEMPLATE)}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                  >
                    CSV upsert + delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidedInput(JSONL_TEMPLATE)}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                  >
                    JSONL sample batch
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <textarea
                  value={rawInput}
                  onChange={(event) => setRawInput(event.target.value)}
                  rows={14}
                  placeholder={RAW_JSON_TEMPLATE}
                  aria-label="Bulk operations raw JSON input"
                  className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 font-mono text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRawInput(RAW_JSON_TEMPLATE)}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                  >
                    Insert sample payload
                  </button>
                </div>
              </div>
            )}

            {validationError && <p className="rounded-2xl border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-sm text-rose-600 dark:border-rose-700/60 dark:bg-rose-900/30 dark:text-rose-300">{validationError}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleValidate}
                className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500"
              >
                Validate payload
              </button>
            </div>
          </section>
        )}

        {step === 'validation' && validationResult && (
          <section className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Valid</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-300">{validationResult.validRows.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Invalid</p>
                <p className="text-lg font-semibold text-rose-600 dark:text-rose-300">{validationResult.invalidRows.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Types</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Upserts: {typeSummary.upsert} · Deletes: {typeSummary.delete}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyValidated}
                disabled={!validatedJson}
                className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
              >
                {copyState === 'copied' ? 'Copied payload' : 'Copy validated JSON'}
              </button>
              <button
                type="button"
                onClick={handleDownloadValidated}
                disabled={!validatedJson}
                className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
              >
                Download validated JSON
              </button>
              {copyError && <span className="text-xs text-rose-600 dark:text-rose-300">{copyError}</span>}
            </div>

            <div className="max-h-80 overflow-auto rounded-2xl border border-slate-200/70 bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/30">
              <table className="min-w-full border-collapse text-left text-sm text-slate-700 dark:text-slate-200">
                <thead className="sticky top-0 bg-white/90 text-xs uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Namespace</th>
                    <th className="px-3 py-2 font-semibold">Key</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {validationResult.rows.map((row) => (
                    <tr key={`${row.label}-${row.index}`} className="border-t border-slate-200/60 dark:border-slate-700/60">
                      <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{row.label}</td>
                      <td className="px-3 py-2">{row.operation?.type ?? '—'}</td>
                      <td className="px-3 py-2">{row.operation?.namespace ?? '—'}</td>
                      <td className="px-3 py-2">{row.operation?.key ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            row.status === 'valid'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                          }`}
                        >
                          {row.status === 'valid' ? 'Valid' : 'Error'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-rose-600 dark:text-rose-300">{row.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep('input')}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Back to editor
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep('confirm')}
                  disabled={validationResult.invalidRows.length > 0 || validationResult.validRows.length === 0}
                  className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue to confirmation
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'confirm' && validationResult && (
          <section className="flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ready to submit</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {validationResult.validRows.length} operations ({typeSummary.upsert} upserts · {typeSummary.delete} deletes) will be sent to the metastore API.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(event) => setContinueOnError(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Continue on error (process all operations even if some fail)
            </label>

            {globalError && <p className="rounded-2xl border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-sm text-rose-600 dark:border-rose-700/60 dark:bg-rose-900/30 dark:text-rose-300">{globalError}</p>}

            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep('validation')}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Back to validation
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? 'Submitting…' : 'Submit bulk operations'}
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'results' && result && (
          <section className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Processed</p>
                <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{result.operations.length}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-sm dark:border-emerald-700/50 dark:bg-emerald-900/30">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600 dark:text-emerald-300">Succeeded</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-300">{successOperations.length}</p>
              </div>
              <div className="rounded-2xl border border-rose-200/80 bg-rose-50/70 p-3 text-sm dark:border-rose-700/50 dark:bg-rose-900/30">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-600 dark:text-rose-300">Failed</p>
                <p className="text-lg font-semibold text-rose-600 dark:text-rose-300">{errorOperations.length}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Sort by</span>
              <select
                value={resultsSortKey}
                onChange={(event) => setResultsSortKey(event.target.value as ResultSortKey)}
                className="rounded-full border border-slate-300/70 bg-white px-3 py-1 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-200"
              >
                <option value="namespace">Namespace</option>
                <option value="key">Key</option>
              </select>
              <button
                type="button"
                onClick={() => setResultsSortDirection(resultsSortDirection === 'asc' ? 'desc' : 'asc')}
                className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                {resultsSortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {errorOperations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadFailures}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                  >
                    Download failure report
                  </button>
                )}
                {errorOperations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRetryFailures}
                    className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow transition-colors hover:bg-violet-500"
                  >
                    Retry failed operations
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ResultList title="Successes" emptyMessage="No successful operations" operations={sortedSuccesses} tone="success" />
              <ResultList title="Failures" emptyMessage="No failures" operations={sortedFailures} tone="error" />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={resetState}
                className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500"
              >
                Start new batch
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

type ResultListProps = {
  title: string;
  emptyMessage: string;
  operations: OperationResult[];
  tone: 'success' | 'error';
};

function ResultList({ title, emptyMessage, operations, tone }: ResultListProps) {
  const badgeClass =
    tone === 'success'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-900/30">
      <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
      {operations.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {operations.map((operation, index) => (
            <li key={`${operation.namespace ?? 'unknown'}-${operation.key ?? index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass}`}>
                  {tone === 'success' ? 'Success' : 'Error'}
                </span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {operation.namespace ?? 'unknown'} / {operation.key ?? '—'}
                </span>
              </div>
              {tone === 'error' && operation.error && (
                <p className="text-xs text-rose-600 dark:text-rose-300">{operation.error.message ?? 'Operation failed'}</p>
              )}
              {tone === 'success' && operation.record && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  version {operation.record.version} · updated {operation.record.updatedAt}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sortOperationResults(
  operations: OperationResult[],
  sortKey: ResultSortKey,
  direction: ResultSortDirection
): OperationResult[] {
  const toSortable = (value: string | undefined) => (value ?? '').toLowerCase();
  const sorted = [...operations].sort((left, right) => {
    const leftValue = toSortable(sortKey === 'namespace' ? left.namespace : left.key);
    const rightValue = toSortable(sortKey === 'namespace' ? right.namespace : right.key);
    if (leftValue === rightValue) {
      return toSortable(left.key).localeCompare(toSortable(right.key));
    }
    return leftValue.localeCompare(rightValue);
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}
