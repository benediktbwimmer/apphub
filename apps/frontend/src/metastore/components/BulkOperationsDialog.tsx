import classNames from 'classnames';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from 'react';
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
import {
  METASTORE_ALERT_ERROR_CLASSES,
  METASTORE_DIALOG_CONTENT_CLASSES,
  METASTORE_DIALOG_SUBTITLE_CLASSES,
  METASTORE_DIALOG_TITLE_CLASSES,
  METASTORE_ERROR_TEXT_CLASSES,
  METASTORE_LINK_ACCENT_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_PRIMARY_BUTTON_CLASSES,
  METASTORE_PRIMARY_BUTTON_SMALL_CLASSES,
  METASTORE_RESULT_BADGE_BASE_CLASSES,
  METASTORE_RESULT_BADGE_ERROR_CLASSES,
  METASTORE_RESULT_BADGE_SUCCESS_CLASSES,
  METASTORE_RESULT_LIST_CONTAINER_CLASSES,
  METASTORE_RESULT_META_CLASSES,
  METASTORE_RESULT_TITLE_CLASSES,
  METASTORE_SECONDARY_BUTTON_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_SEGMENTED_BUTTON_ACTIVE_CLASSES,
  METASTORE_SEGMENTED_BUTTON_BASE_CLASSES,
  METASTORE_SEGMENTED_BUTTON_INACTIVE_CLASSES,
  METASTORE_SEGMENTED_CONTAINER_CLASSES,
  METASTORE_SELECT_CLASSES,
  METASTORE_STEPPER_BADGE_ACTIVE_CLASSES,
  METASTORE_STEPPER_BADGE_BASE_CLASSES,
  METASTORE_STEPPER_BADGE_COMPLETED_CLASSES,
  METASTORE_STEPPER_BADGE_PENDING_CLASSES,
  METASTORE_STEPPER_LIST_CLASSES,
  METASTORE_SUMMARY_CARD_CLASSES,
  METASTORE_SUMMARY_LABEL_CLASSES,
  METASTORE_SUMMARY_VALUE_DANGER_CLASSES,
  METASTORE_SUMMARY_VALUE_NEUTRAL_CLASSES,
  METASTORE_SUMMARY_VALUE_SUCCESS_CLASSES,
  METASTORE_TEXT_AREA_MONO_CLASSES,
  METASTORE_CHECKBOX_CLASSES
} from '../metastoreTokens';

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
      contentClassName={METASTORE_DIALOG_CONTENT_CLASSES}
    >
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={dialogTitleId} className={METASTORE_DIALOG_TITLE_CLASSES}>
                Metastore bulk operations studio
              </h2>
              <p className={METASTORE_DIALOG_SUBTITLE_CLASSES}>
                Import CSV or JSONL data, validate it against metastore schemas, then submit with per-operation previews.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
            >
              Close
            </button>
          </div>
          <ol className={METASTORE_STEPPER_LIST_CLASSES}>
            {STEP_ORDER.map((entry, index) => {
              const isActive = index === currentStepIndex;
              const isCompleted = index < currentStepIndex;
              return (
                <li
                  key={entry.id}
                  className={classNames(
                    METASTORE_STEPPER_BADGE_BASE_CLASSES,
                    isActive
                      ? METASTORE_STEPPER_BADGE_ACTIVE_CLASSES
                      : isCompleted
                      ? METASTORE_STEPPER_BADGE_COMPLETED_CLASSES
                      : METASTORE_STEPPER_BADGE_PENDING_CLASSES
                  )}
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
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('guided')}
                className={classNames(
                  mode === 'guided' ? METASTORE_PRIMARY_BUTTON_CLASSES : METASTORE_SECONDARY_BUTTON_CLASSES
                )}
              >
                Guided import
              </button>
              <button
                type="button"
                onClick={() => setMode('raw')}
                className={classNames(
                  mode === 'raw' ? METASTORE_PRIMARY_BUTTON_CLASSES : METASTORE_SECONDARY_BUTTON_CLASSES
                )}
              >
                Raw JSON
              </button>
              <span className={classNames('ml-auto', METASTORE_META_TEXT_CLASSES)}>
                Need a refresher?{' '}
                <a
                  className={METASTORE_LINK_ACCENT_CLASSES}
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
                  <span className={METASTORE_SUMMARY_LABEL_CLASSES}>Source format</span>
                  <div className={METASTORE_SEGMENTED_CONTAINER_CLASSES}>
                    <button
                      type="button"
                      onClick={() => setGuidedFormat('csv')}
                      className={classNames(
                        METASTORE_SEGMENTED_BUTTON_BASE_CLASSES,
                        guidedFormat === 'csv'
                          ? METASTORE_SEGMENTED_BUTTON_ACTIVE_CLASSES
                          : METASTORE_SEGMENTED_BUTTON_INACTIVE_CLASSES
                      )}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuidedFormat('jsonl')}
                      className={classNames(
                        METASTORE_SEGMENTED_BUTTON_BASE_CLASSES,
                        guidedFormat === 'jsonl'
                          ? METASTORE_SEGMENTED_BUTTON_ACTIVE_CLASSES
                          : METASTORE_SEGMENTED_BUTTON_INACTIVE_CLASSES
                      )}
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
                      className={METASTORE_SECONDARY_BUTTON_CLASSES}
                    >
                      Upload file…
                    </button>
                    {fileName && <span className={METASTORE_META_TEXT_CLASSES}>{fileName}</span>}
                  </div>
                </div>
                <textarea
                  value={guidedInput}
                  onChange={(event) => setGuidedInput(event.target.value)}
                  rows={12}
                  placeholder={guidedFormat === 'csv' ? CSV_TEMPLATE : JSONL_TEMPLATE}
                  aria-label={guidedFormat === 'csv' ? 'Bulk operations CSV input' : 'Bulk operations JSONL input'}
                  className={METASTORE_TEXT_AREA_MONO_CLASSES}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={METASTORE_SUMMARY_LABEL_CLASSES}>Templates</span>
                  <button
                    type="button"
                    onClick={() => setGuidedInput(CSV_TEMPLATE)}
                    className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
                  >
                    CSV upsert + delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidedInput(JSONL_TEMPLATE)}
                    className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
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
                  className={METASTORE_TEXT_AREA_MONO_CLASSES}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRawInput(RAW_JSON_TEMPLATE)}
                    className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
                  >
                    Insert sample payload
                  </button>
                </div>
              </div>
            )}

            {validationError && <p className={METASTORE_ALERT_ERROR_CLASSES}>{validationError}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className={METASTORE_SECONDARY_BUTTON_CLASSES}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleValidate}
                className={METASTORE_PRIMARY_BUTTON_CLASSES}
              >
                Validate payload
              </button>
            </div>
          </section>
        )}

        {step === 'validation' && validationResult && (
          <section className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Valid</p>
                <p className={METASTORE_SUMMARY_VALUE_SUCCESS_CLASSES}>{validationResult.validRows.length}</p>
              </div>
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Invalid</p>
                <p className={METASTORE_SUMMARY_VALUE_DANGER_CLASSES}>{validationResult.invalidRows.length}</p>
              </div>
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Types</p>
                <p className={METASTORE_SUMMARY_VALUE_NEUTRAL_CLASSES}>
                  Upserts: {typeSummary.upsert} · Deletes: {typeSummary.delete}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyValidated}
                disabled={!validatedJson}
                className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
              >
                {copyState === 'copied' ? 'Copied payload' : 'Copy validated JSON'}
              </button>
              <button
                type="button"
                onClick={handleDownloadValidated}
                disabled={!validatedJson}
                className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
              >
                Download validated JSON
              </button>
              {copyError && <span className={METASTORE_ERROR_TEXT_CLASSES}>{copyError}</span>}
            </div>

            <div className="max-h-80 overflow-auto rounded-2xl border border-subtle bg-surface-glass">
              <table className="min-w-full border-collapse text-left text-scale-sm text-secondary">
                <thead
                  className={classNames(
                    'sticky top-0 bg-surface-muted text-scale-xs font-weight-semibold uppercase tracking-[0.3em]',
                    METASTORE_META_TEXT_CLASSES
                  )}
                >
                  <tr>
                    <th className="px-3 py-2 font-weight-semibold">Row</th>
                    <th className="px-3 py-2 font-weight-semibold">Type</th>
                    <th className="px-3 py-2 font-weight-semibold">Namespace</th>
                    <th className="px-3 py-2 font-weight-semibold">Key</th>
                    <th className="px-3 py-2 font-weight-semibold">Status</th>
                    <th className="px-3 py-2 font-weight-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {validationResult.rows.map((row) => (
                    <tr
                      key={`${row.label}-${row.index}`}
                      className={classNames(
                        'border-t border-subtle',
                        row.status === 'valid' ? 'bg-status-success-soft' : 'bg-status-danger-soft'
                      )}
                    >
                      <td className={classNames('px-3 py-2 font-mono text-scale-xs', METASTORE_META_TEXT_CLASSES)}>
                        {row.label}
                      </td>
                      <td className="px-3 py-2 text-primary">{row.operation?.type ?? '—'}</td>
                      <td className="px-3 py-2 text-primary">{row.operation?.namespace ?? '—'}</td>
                      <td className="px-3 py-2 text-primary">{row.operation?.key ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={classNames(
                            METASTORE_RESULT_BADGE_BASE_CLASSES,
                            row.status === 'valid'
                              ? METASTORE_RESULT_BADGE_SUCCESS_CLASSES
                              : METASTORE_RESULT_BADGE_ERROR_CLASSES
                          )}
                        >
                          {row.status === 'valid' ? 'Valid' : 'Error'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-scale-xs text-secondary">{row.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep('input')}
                className={METASTORE_SECONDARY_BUTTON_CLASSES}
              >
                Back to editor
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className={METASTORE_SECONDARY_BUTTON_CLASSES}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep('confirm')}
                  disabled={validationResult.invalidRows.length > 0 || validationResult.validRows.length === 0}
                  className={METASTORE_PRIMARY_BUTTON_CLASSES}
                >
                  Continue to confirmation
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'confirm' && validationResult && (
          <section className="flex flex-col gap-5">
            <div className={METASTORE_SUMMARY_CARD_CLASSES}>
              <h3 className={METASTORE_RESULT_TITLE_CLASSES}>Ready to submit</h3>
              <p className={METASTORE_DIALOG_SUBTITLE_CLASSES}>
                {validationResult.validRows.length} operations ({typeSummary.upsert} upserts · {typeSummary.delete} deletes) will be sent to the metastore API.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-scale-sm text-secondary">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(event) => setContinueOnError(event.target.checked)}
                className={METASTORE_CHECKBOX_CLASSES}
              />
              Continue on error (process all operations even if some fail)
            </label>

            {globalError && <p className={METASTORE_ALERT_ERROR_CLASSES}>{globalError}</p>}

            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep('validation')}
                className={METASTORE_SECONDARY_BUTTON_CLASSES}
              >
                Back to validation
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className={METASTORE_SECONDARY_BUTTON_CLASSES}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className={METASTORE_PRIMARY_BUTTON_CLASSES}
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
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Processed</p>
                <p className={METASTORE_SUMMARY_VALUE_NEUTRAL_CLASSES}>{result.operations.length}</p>
              </div>
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Succeeded</p>
                <p className={METASTORE_SUMMARY_VALUE_SUCCESS_CLASSES}>{successOperations.length}</p>
              </div>
              <div className={METASTORE_SUMMARY_CARD_CLASSES}>
                <p className={METASTORE_SUMMARY_LABEL_CLASSES}>Failed</p>
                <p className={METASTORE_SUMMARY_VALUE_DANGER_CLASSES}>{errorOperations.length}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className={METASTORE_SUMMARY_LABEL_CLASSES}>Sort by</span>
              <select
                value={resultsSortKey}
                onChange={(event) => setResultsSortKey(event.target.value as ResultSortKey)}
                className={METASTORE_SELECT_CLASSES}
              >
                <option value="namespace">Namespace</option>
                <option value="key">Key</option>
              </select>
              <button
                type="button"
                onClick={() => setResultsSortDirection(resultsSortDirection === 'asc' ? 'desc' : 'asc')}
                className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
              >
                {resultsSortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {errorOperations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadFailures}
                    className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
                  >
                    Download failure report
                  </button>
                )}
                {errorOperations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRetryFailures}
                    className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
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
                className={METASTORE_SECONDARY_BUTTON_CLASSES}
              >
                Close
              </button>
              <button
                type="button"
                onClick={resetState}
                className={METASTORE_PRIMARY_BUTTON_CLASSES}
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
  const badgeClass = classNames(
    METASTORE_RESULT_BADGE_BASE_CLASSES,
    tone === 'success' ? METASTORE_RESULT_BADGE_SUCCESS_CLASSES : METASTORE_RESULT_BADGE_ERROR_CLASSES
  );

  return (
    <div className={METASTORE_RESULT_LIST_CONTAINER_CLASSES}>
      <h4 className={classNames('mb-3', METASTORE_RESULT_TITLE_CLASSES)}>{title}</h4>
      {operations.length === 0 ? (
        <p className={classNames('text-scale-sm', METASTORE_META_TEXT_CLASSES)}>{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {operations.map((operation, index) => (
            <li key={`${operation.namespace ?? 'unknown'}-${operation.key ?? index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={badgeClass}>
                  {tone === 'success' ? 'Success' : 'Error'}
                </span>
                <span className={METASTORE_RESULT_TITLE_CLASSES}>
                  {operation.namespace ?? 'unknown'} / {operation.key ?? '—'}
                </span>
              </div>
              {tone === 'error' && operation.error && (
                <p className={METASTORE_ERROR_TEXT_CLASSES}>{operation.error.message ?? 'Operation failed'}</p>
              )}
              {tone === 'success' && operation.record && (
                <p className={METASTORE_RESULT_META_CLASSES}>
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
