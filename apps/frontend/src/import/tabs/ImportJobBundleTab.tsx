import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  FormActions,
  FormButton,
  FormField,
  FormFeedback,
  FormSection
} from '../../components/form';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { Spinner } from '../../components';
import { useToasts } from '../../components/toast';
import { useAnalytics } from '../../utils/useAnalytics';
import {
  useJobImportWorkflow,
  type JobImportPreviewResult,
  type JobImportWarning,
  type JobImportValidationError,
  type JobImportConfirmResult
} from '../useJobImportWorkflow';
import type { JobScenario } from '../examples';

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const TEXTAREA_CLASSES = `${INPUT_CLASSES} min-h-[100px] resize-y`;

const SOURCE_BUTTON_BASE =
  'inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const SOURCE_BUTTON_ACTIVE = `${SOURCE_BUTTON_BASE} bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50`;

const SOURCE_BUTTON_INACTIVE = `${SOURCE_BUTTON_BASE} bg-white/70 text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const JOB_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/job-bundles.md';

function WarningList({ warnings }: { warnings: JobImportWarning[] }) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <FormFeedback tone="info">
      <div className="flex flex-col gap-2">
        <strong className="text-sm font-semibold text-slate-700 dark:text-slate-200">Compatibility warnings</strong>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          {warnings.map((warning, index) => (
            <li key={`${warning.code ?? 'warning'}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      </div>
    </FormFeedback>
  );
}

function ErrorList({ errors }: { errors: JobImportValidationError[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <FormFeedback tone="error">
      <div className="flex flex-col gap-2">
        <strong className="text-sm font-semibold text-slate-700 dark:text-slate-200">Validation errors</strong>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          {errors.map((err, index) => (
            <li key={`${err.code ?? 'error'}-${index}`}>
              {err.field ? <span className="font-semibold">{err.field}: </span> : null}
              {err.message}
            </li>
          ))}
        </ul>
      </div>
    </FormFeedback>
  );
}

function getCapabilities(bundle: JobImportPreviewResult['bundle']) {
  const capabilities = bundle.capabilities ?? [];
  if (capabilities.length === 0) {
    return 'None';
  }
  return capabilities.join(', ');
}

function DryRunDetails({ dryRun }: { dryRun: JobImportPreviewResult['dryRun'] }) {
  if (!dryRun) {
    return null;
  }
  let decodedLogs: string | null = null;
  if (dryRun.logs) {
    try {
      decodedLogs = atob(dryRun.logs);
    } catch {
      decodedLogs = dryRun.logs;
    }
  }
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
          Dry-run status
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-600 dark:text-violet-300">
          {dryRun.status}
        </span>
      </div>
      {dryRun.resultUrl && (
        <a
          href={dryRun.resultUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
        >
          View dry-run report
          <span aria-hidden="true">→</span>
        </a>
      )}
      {decodedLogs && (
        <details className="mt-2 rounded-xl bg-slate-100/70 p-2 text-xs dark:bg-slate-800/60">
          <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">
            Logs preview
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-200">
            {decodedLogs}
          </pre>
        </details>
      )}
    </div>
  );
}

function ConfirmSummary({ result }: { result: JobImportConfirmResult }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-emerald-400/70 bg-emerald-50/80 p-4 text-sm shadow-sm dark:border-emerald-400/60 dark:bg-emerald-500/15 dark:text-emerald-100">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600 dark:text-emerald-200">
          Job imported
        </span>
        <h3 className="text-lg font-semibold text-emerald-700 dark:text-emerald-100">{result.job.slug}</h3>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600/80 dark:text-emerald-200/80">
            Version
          </dt>
          <dd>{result.job.version}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600/80 dark:text-emerald-200/80">
            Runtime
          </dt>
          <dd>{result.job.runtime ?? 'n/a'}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600/80 dark:text-emerald-200/80">
            Capabilities
          </dt>
          <dd>{result.job.capabilities && result.job.capabilities.length > 0 ? result.job.capabilities.join(', ') : 'None'}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600/80 dark:text-emerald-200/80">
            Created
          </dt>
          <dd>{new Date(result.job.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      {result.nextSteps?.monitoringUrl && (
        <a
          href={result.nextSteps.monitoringUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 transition-colors hover:text-emerald-600 dark:text-emerald-200 dark:hover:text-emerald-100"
        >
          View execution history
          <span aria-hidden="true">→</span>
        </a>
      )}
    </div>
  );
}

type ImportJobBundleTabProps = {
  scenario?: JobScenario | null;
  scenarioRequestToken?: number;
  onScenarioCleared?: () => void;
};

export default function ImportJobBundleTab({ scenario, scenarioRequestToken, onScenarioCleared }: ImportJobBundleTabProps) {
  const {
    form,
    setForm,
    setFormField,
    setArchive,
    archive,
    previewLoading,
    previewError,
    previewValidationErrors,
    previewResult,
    runPreview,
    confirmLoading,
    confirmError,
    confirmResult,
    confirmImport,
    reset,
    canConfirm
  } = useJobImportWorkflow();
  const { pushToast } = useToasts();
  const analytics = useAnalytics();
  const lastPreviewError = useRef<string | null>(null);
  const lastConfirmError = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  useEffect(() => {
    if (!scenario) {
      setScenarioLoading(false);
      setScenarioError(null);
    }
  }, [scenario]);

  useEffect(() => {
    if (!scenario || typeof scenarioRequestToken === 'undefined') {
      return;
    }
    let cancelled = false;

    const applyScenario = async () => {
      setScenarioError(null);
      reset();
      setForm({
        source: scenario.form.source,
        reference: scenario.form.reference ?? '',
        notes: scenario.form.notes ?? ''
      });

      if (scenario.form.source === 'upload') {
        if (!scenario.bundle) {
          setScenarioError('Bundle asset missing for this scenario.');
          return;
        }
        setScenarioLoading(true);
        try {
          const response = await fetch(scenario.bundle.publicPath);
          if (!response.ok) {
            throw new Error(`Failed to load bundle (status ${response.status})`);
          }
          const blob = await response.blob();
          if (cancelled) {
            return;
          }
          const filename = scenario.bundle.filename || `${scenario.id}.tar.gz`;
          const contentType = scenario.bundle.contentType ?? blob.type || 'application/gzip';
          const file = new File([blob], filename, { type: contentType });
          setArchive(file);
          analytics.trackEvent('import_example_bundle_loaded', {
            scenarioId: scenario.id,
            source: 'upload'
          });
        } catch (err) {
          if (!cancelled) {
            setScenarioError((err as Error).message ?? 'Failed to load bundle asset');
            setArchive(null);
          }
        } finally {
          if (!cancelled) {
            setScenarioLoading(false);
          }
        }
      } else {
        setArchive(null);
      }
    };

    void applyScenario();

    return () => {
      cancelled = true;
    };
  }, [analytics, reset, scenario, scenarioRequestToken, setArchive, setForm]);

  useEffect(() => {
    if (previewResult) {
      pushToast({
        tone: 'success',
        title: 'Bundle validated',
        description: 'Review the metadata and confirm to import the job.'
      });
    }
  }, [previewResult, pushToast]);

  useEffect(() => {
    if (confirmResult) {
      pushToast({
        tone: 'success',
        title: 'Job imported',
        description: `Registered ${confirmResult.job.slug}@${confirmResult.job.version}.`
      });
    }
  }, [confirmResult, pushToast]);

  useEffect(() => {
    if (previewError && previewError !== lastPreviewError.current) {
      analytics.trackEvent('jobs_import_failed', { stage: 'preview', message: previewError });
      pushToast({ tone: 'error', title: 'Preview failed', description: previewError });
      lastPreviewError.current = previewError;
    }
  }, [analytics, previewError, pushToast]);

  useEffect(() => {
    if (confirmError && confirmError !== lastConfirmError.current) {
      analytics.trackEvent('jobs_import_failed', { stage: 'confirm', message: confirmError });
      pushToast({ tone: 'error', title: 'Import failed', description: confirmError });
      lastConfirmError.current = confirmError;
    }
  }, [analytics, confirmError, pushToast]);

  const handleSourceChange = (source: 'upload' | 'registry') => {
    setFormField('source', source);
    if (source === 'registry') {
      setArchive(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchive(file);
  };

  const handlePreviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (scenarioLoading) {
      pushToast({
        tone: 'info',
        title: 'Bundle still loading',
        description: 'Wait for the example bundle to finish downloading before running the preview.'
      });
      return;
    }
    await runPreview();
  };

  const handleConfirm = async () => {
    await confirmImport();
  };

  const handleReset = () => {
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    lastPreviewError.current = null;
    lastConfirmError.current = null;
  };

  const parametersSchema = useMemo(() => {
    if (!previewResult?.bundle.parameters?.schema) {
      return null;
    }
    try {
      return JSON.stringify(previewResult.bundle.parameters.schema, null, 2);
    } catch {
      return null;
    }
  }, [previewResult?.bundle.parameters?.schema]);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {scenario ? (
        <div className="rounded-2xl border border-violet-300/70 bg-violet-50/70 p-4 text-sm text-slate-700 shadow-sm dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600 dark:text-violet-300">
                Example scenario active
              </span>
              <p>
                Prefills the form with <strong>{scenario.title}</strong>.{' '}
                {scenario.form.source === 'upload'
                  ? 'The bundle downloads from the repository so you can preview immediately.'
                  : 'Using the bundled registry reference to preview or import without extra setup.'}
              </p>
              {scenarioLoading ? (
                <span className="text-xs font-semibold text-violet-600 dark:text-violet-300">Fetching bundle…</span>
              ) : null}
              {scenarioError ? (
                <FormFeedback tone="error">Bundle download failed: {scenarioError}</FormFeedback>
              ) : null}
            </div>
            {onScenarioCleared && (
              <button
                type="button"
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-600 shadow-sm transition hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800"
                onClick={onScenarioCleared}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      ) : null}
      <FormSection as="form" onSubmit={handlePreviewSubmit} aria-label="Import job bundle">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Source</span>
          <div className="flex gap-2 rounded-full border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
            <button
              type="button"
              className={form.source === 'upload' ? SOURCE_BUTTON_ACTIVE : SOURCE_BUTTON_INACTIVE}
              onClick={() => handleSourceChange('upload')}
            >
              Upload archive
            </button>
            <button
              type="button"
              className={form.source === 'registry' ? SOURCE_BUTTON_ACTIVE : SOURCE_BUTTON_INACTIVE}
              onClick={() => handleSourceChange('registry')}
            >
              Registry reference
            </button>
          </div>
        </div>
        {form.source === 'upload' ? (
          <FormField label="Bundle archive" htmlFor="job-archive" hint="Upload the .tar.gz bundle produced by the CLI">
            <input
              ref={fileInputRef}
              id="job-archive"
              type="file"
              accept=".tar.gz,.tgz"
              className={INPUT_CLASSES}
              onChange={handleFileChange}
              required={!archive}
              disabled={scenarioLoading}
            />
            {archive && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Selected: {archive.name}</p>
            )}
          </FormField>
        ) : (
          <FormField label="Registry reference" htmlFor="job-reference" hint="Provide slug@version from the bundle registry">
            <input
              id="job-reference"
              className={INPUT_CLASSES}
              value={form.reference}
              onChange={(event) => setFormField('reference', event.target.value)}
              placeholder="example-job@1.2.3"
              required
            />
          </FormField>
        )}
        {form.source === 'upload' && (
          <FormField label="Optional registry reference" htmlFor="job-reference">
            <input
              id="job-reference"
              className={INPUT_CLASSES}
              value={form.reference}
              onChange={(event) => setFormField('reference', event.target.value)}
              placeholder="example-job@1.2.3"
            />
          </FormField>
        )}
        <FormField label="Operator notes" htmlFor="job-notes" hint="Visible in activity logs and import history">
          <textarea
            id="job-notes"
            className={TEXTAREA_CLASSES}
            value={form.notes}
            onChange={(event) => setFormField('notes', event.target.value)}
            placeholder="Describe why this bundle version is being imported"
          />
        </FormField>
        <FormActions>
          <FormButton
            type="submit"
            disabled={
              previewLoading ||
              scenarioLoading ||
              (form.source === 'upload' && !archive) ||
              (form.source === 'registry' && !form.reference.trim())
            }
          >
            {previewLoading ? <Spinner label="Validating…" size="xs" /> : 'Validate bundle'}
          </FormButton>
          <FormButton type="button" variant="secondary" size="sm" onClick={handleReset}>
            Reset form
          </FormButton>
        </FormActions>
        {previewValidationErrors.length > 0 && !previewResult && <ErrorList errors={previewValidationErrors} />}
        {!previewResult && !confirmResult && (
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
            <p>
              Validate job bundles before publishing them to operators. AppHub verifies signatures, checks runtime
              capabilities, and runs an optional sandbox dry-run prior to confirmation.
            </p>
            <a
              href={JOB_DOC_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
            >
              Review job bundle reference
              <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </FormSection>

      <FormSection>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Preview & confirmation</h2>
        {previewResult && !confirmResult && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600 dark:text-violet-300">
                  Bundle metadata
                </span>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {previewResult.bundle.slug} · {previewResult.bundle.version}
                </h3>
                {previewResult.bundle.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{previewResult.bundle.description}</p>
                )}
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Checksum
                  </dt>
                  <dd className="font-mono text-xs text-slate-700 dark:text-slate-200">
                    {previewResult.bundle.checksum ?? 'n/a'}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Capabilities
                  </dt>
                  <dd>{getCapabilities(previewResult.bundle)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Runtime
                  </dt>
                  <dd>{previewResult.bundle.runtime ?? 'n/a'}</dd>
                </div>
              </dl>
            </div>
            <WarningList warnings={previewResult.warnings} />
            <ErrorList errors={previewResult.errors} />
            {parametersSchema && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Parameter schema</h4>
                <JsonSyntaxHighlighter
                  value={parametersSchema}
                  className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-200"
                />
              </div>
            )}
            <DryRunDetails dryRun={previewResult.dryRun} />
            <FormActions>
              <FormButton
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm || confirmLoading || scenarioLoading}
              >
                {confirmLoading ? <Spinner label="Importing…" size="xs" /> : 'Confirm import'}
              </FormButton>
              <FormButton type="button" variant="secondary" size="sm" onClick={handleReset}>
                Start over
              </FormButton>
            </FormActions>
          </div>
        )}
        {confirmResult && (
          <div className="flex flex-col gap-4">
            <ConfirmSummary result={confirmResult} />
            <FormActions>
              <FormButton type="button" variant="secondary" size="sm" onClick={handleReset}>
                Import another job
              </FormButton>
            </FormActions>
          </div>
        )}
        {!previewResult && !confirmResult && previewError && (
          <FormFeedback tone="error">{previewError}</FormFeedback>
        )}
        {confirmError && !confirmResult && <FormFeedback tone="error">{confirmError}</FormFeedback>}
      </FormSection>
    </div>
  );
}
