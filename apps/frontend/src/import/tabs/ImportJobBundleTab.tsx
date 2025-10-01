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
import { ScenarioSwitcher } from '../components/ScenarioSwitcher';
import {
  BODY_TEXT,
  CARD_SECTION,
  HEADING_SECONDARY,
  INPUT,
  LINK_ACCENT,
  POSITIVE_SURFACE,
  SECONDARY_BUTTON,
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE,
  STATUS_BADGE_INFO,
  STATUS_MESSAGE,
  TEXTAREA
} from '../importTokens';

const segmentedButtonClass = (active: boolean): string =>
  `${SEGMENTED_BUTTON_BASE} ${active ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`;

const JOB_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/job-bundles.md';

function WarningList({ warnings }: { warnings: JobImportWarning[] }) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <FormFeedback tone="info">
      <div className="flex flex-col gap-2">
        <strong className={HEADING_SECONDARY}>Compatibility warnings</strong>
        <ul className="list-disc space-y-1 pl-5 text-scale-sm text-secondary">
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
        <strong className={HEADING_SECONDARY}>Validation errors</strong>
        <ul className="list-disc space-y-1 pl-5 text-scale-sm text-secondary">
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
    <div className={`${CARD_SECTION} gap-2`}>
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Dry-run status</span>
        <span className={STATUS_BADGE_INFO}>{dryRun.status}</span>
      </div>
      {dryRun.resultUrl && (
        <a
          href={dryRun.resultUrl}
          target="_blank"
          rel="noreferrer"
          className={LINK_ACCENT}
        >
          View dry-run report
          <span aria-hidden="true">→</span>
        </a>
      )}
      {decodedLogs && (
        <details className="mt-2 rounded-xl bg-surface-glass-soft p-2 text-scale-xs">
          <summary className="cursor-pointer font-weight-semibold text-secondary">
            Logs preview
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-scale-2xs text-secondary">
            {decodedLogs}
          </pre>
        </details>
      )}
    </div>
  );
}

function ConfirmSummary({ result }: { result: JobImportConfirmResult }) {
  return (
    <div className={POSITIVE_SURFACE}>
      <div className="flex flex-col gap-1">
        <span className={SECTION_LABEL}>Job imported</span>
        <h3 className={HEADING_SECONDARY}>{result.job.slug}</h3>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className={SECTION_LABEL}>Version</dt>
          <dd>{result.job.version}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={SECTION_LABEL}>Runtime</dt>
          <dd>{result.job.runtime ?? 'n/a'}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={SECTION_LABEL}>Capabilities</dt>
          <dd>{result.job.capabilities && result.job.capabilities.length > 0 ? result.job.capabilities.join(', ') : 'None'}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={SECTION_LABEL}>Created</dt>
          <dd>{new Date(result.job.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      {result.nextSteps?.monitoringUrl && (
        <a
          href={result.nextSteps.monitoringUrl}
          target="_blank"
          rel="noreferrer"
          className={LINK_ACCENT}
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
  scenarioOptions?: { id: string; title: string }[];
  activeScenarioId?: string | null;
  onScenarioSelected?: (id: string) => void;
};

export default function ImportJobBundleTab({
  scenario,
  scenarioRequestToken,
  onScenarioCleared,
  scenarioOptions,
  activeScenarioId,
  onScenarioSelected
}: ImportJobBundleTabProps) {
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
        notes: scenario.form.notes ?? '',
        exampleSlug: scenario.exampleSlug ?? null
      });

      if (scenario.exampleSlug) {
        setArchive(null);
        analytics.trackEvent('import_example_bundle_loaded', {
          scenarioId: scenario.id,
          source: 'example'
        });
        return;
      }

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
      const contentType = scenario.bundle.contentType ?? (blob.type || 'application/gzip');
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
        <div className={`${CARD_SECTION} ${CARD_SURFACE_ACTIVE} gap-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1 text-scale-sm text-secondary">
              <span className={SECTION_LABEL}>Example scenario active</span>
              <p className={BODY_TEXT}>
                Prefills the form with <strong>{scenario.title}</strong>.{' '}
                {scenario.exampleSlug
                  ? 'The bundle builds from source on demand so you can preview or import without downloading artifacts.'
                  : scenario.form.source === 'upload'
                    ? 'The bundle downloads from the repository so you can preview immediately.'
                    : 'Using the bundled registry reference to preview or import without extra setup.'}
              </p>
              {scenario.exampleSlug ? null : scenarioLoading ? (
                <span className={STATUS_MESSAGE}>Fetching bundle…</span>
              ) : null}
              {scenarioError ? <FormFeedback tone="error">Bundle download failed: {scenarioError}</FormFeedback> : null}
            </div>
            {onScenarioCleared ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={onScenarioCleared}>
                Reset
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ScenarioSwitcher options={scenarioOptions ?? []} activeId={activeScenarioId ?? null} onSelect={onScenarioSelected} />
      <FormSection as="form" onSubmit={handlePreviewSubmit} aria-label="Import job bundle">
        <div className="flex flex-col gap-2">
          <span className={HEADING_SECONDARY}>Source</span>
          <div className="flex gap-2 rounded-full border border-subtle bg-surface-glass-soft p-1">
            <button
              type="button"
              className={segmentedButtonClass(form.source === 'upload')}
              onClick={() => handleSourceChange('upload')}
            >
              Upload archive
            </button>
            <button
              type="button"
              className={segmentedButtonClass(form.source === 'registry')}
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
              className={INPUT}
              onChange={handleFileChange}
              required={!archive && !form.exampleSlug}
              disabled={scenarioLoading || Boolean(form.exampleSlug)}
            />
            {form.exampleSlug ? (
              <p className={STATUS_MESSAGE}>
                Example bundles build automatically; no upload required.
              </p>
            ) : null}
            {archive && !form.exampleSlug && (
              <p className={STATUS_MESSAGE}>Selected: {archive.name}</p>
            )}
          </FormField>
        ) : (
          <FormField label="Registry reference" htmlFor="job-reference" hint="Provide slug@version from the bundle registry">
            <input
              id="job-reference"
              className={INPUT}
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
              className={INPUT}
              value={form.reference}
              onChange={(event) => setFormField('reference', event.target.value)}
              placeholder="example-job@1.2.3"
            />
          </FormField>
        )}
        <FormField label="Operator notes" htmlFor="job-notes" hint="Visible in activity logs and import history">
          <textarea
            id="job-notes"
            className={TEXTAREA}
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
              (form.source === 'upload' && !form.exampleSlug && !archive) ||
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
          <div className={`${CARD_SECTION} text-scale-sm`}>
            <p className={BODY_TEXT}>
              Validate job bundles before publishing them to operators. AppHub verifies signatures, checks runtime
              capabilities, and runs an optional sandbox dry-run prior to confirmation.
            </p>
            <a className={LINK_ACCENT} href={JOB_DOC_URL} target="_blank" rel="noreferrer">
              Review job bundle reference
              <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </FormSection>

      <FormSection>
        <h2 className={HEADING_SECONDARY}>Preview & confirmation</h2>
        {previewResult && !confirmResult && (
          <div className="flex flex-col gap-4">
            <div className={`${CARD_SECTION} text-scale-sm`}>
              <div className="flex flex-col gap-1">
                <span className={SECTION_LABEL}>Bundle metadata</span>
                <h3 className={HEADING_SECONDARY}>
                  {previewResult.bundle.slug} · {previewResult.bundle.version}
                </h3>
                {previewResult.bundle.description ? (
                  <p className={BODY_TEXT}>{previewResult.bundle.description}</p>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className={SECTION_LABEL}>Checksum</dt>
                  <dd className="font-mono text-scale-xs text-primary">{previewResult.bundle.checksum ?? 'n/a'}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className={SECTION_LABEL}>Capabilities</dt>
                  <dd>{getCapabilities(previewResult.bundle)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className={SECTION_LABEL}>Runtime</dt>
                  <dd>{previewResult.bundle.runtime ?? 'n/a'}</dd>
                </div>
              </dl>
            </div>
            <WarningList warnings={previewResult.warnings} />
            <ErrorList errors={previewResult.errors} />
            {parametersSchema && (
              <div className={`${CARD_SECTION} text-scale-sm`}>
                <h4 className={HEADING_SECONDARY}>Parameter schema</h4>
                <JsonSyntaxHighlighter
                  value={parametersSchema}
                  className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-scale-2xs text-secondary"
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
