import { useEffect, useMemo, useRef, type ChangeEvent } from 'react';
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
  type JobImportWarning,
  type JobImportValidationError
} from '../useJobImportWorkflow';
import {
  BODY_TEXT,
  CARD_SECTION,
  HEADING_SECONDARY,
  INPUT,
  LINK_ACCENT,
  POSITIVE_SURFACE,
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE,
  TEXTAREA,
  SECTION_LABEL
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

function getCapabilities(bundle: { capabilities?: string[] | null }) {
  const capabilities = bundle.capabilities ?? [];
  if (capabilities.length === 0) {
    return 'None';
  }
  return capabilities.join(', ');
}

export default function ImportJobBundleTab() {
  const {
    form,
    setForm,
    setFormField,
    setArchive,
    archive,
    previewLoading,
    previewError,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (confirmResult) {
      pushToast({
        tone: 'success',
        title: 'Job bundle imported',
        description: `${confirmResult.job.slug}@${confirmResult.job.version} is now available.`
      });
    }
  }, [confirmResult, pushToast]);

  useEffect(() => {
    if (confirmError) {
      pushToast({ tone: 'error', title: 'Import failed', description: confirmError });
    }
  }, [confirmError, pushToast]);

  useEffect(() => {
    if (previewError) {
      pushToast({ tone: 'error', title: 'Preview failed', description: previewError });
    }
  }, [previewError, pushToast]);

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
    setArchive(file);
  };

  const handleReset = () => {
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const previewSummary = useMemo(() => {
    if (!previewResult) {
      return null;
    }

    const { bundle } = previewResult;
    return (
      <div className={`${CARD_SECTION} gap-4`}>
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Preview bundle</span>
          <h3 className={HEADING_SECONDARY}>{bundle.slug}</h3>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Version</dt>
            <dd>{bundle.version}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Runtime</dt>
            <dd>{bundle.runtime ?? 'unknown'}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Capabilities</dt>
            <dd>{getCapabilities(bundle)}</dd>
          </div>
        </dl>
        <WarningList warnings={previewResult.warnings} />
        <ErrorList errors={previewResult.errors} />
        {previewResult.bundle.parameters?.schema ? (
          <div className={`${CARD_SECTION} gap-2`}>
            <span className={SECTION_LABEL}>Parameters schema</span>
            <JsonSyntaxHighlighter value={JSON.stringify(previewResult.bundle.parameters.schema, null, 2)} />
          </div>
        ) : null}
      </div>
    );
  }, [previewResult]);

  const confirmSummary = useMemo(() => {
    if (!confirmResult) {
      return null;
    }
    return (
      <div className={POSITIVE_SURFACE}>
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Job imported</span>
          <h3 className={HEADING_SECONDARY}>{confirmResult.job.slug}</h3>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className={SECTION_LABEL}>Version</dt>
            <dd>{confirmResult.job.version}</dd>
          </div>
          <div>
            <dt className={SECTION_LABEL}>Runtime</dt>
            <dd>{confirmResult.job.runtime ?? 'unknown'}</dd>
          </div>
        </dl>
        {confirmResult.nextSteps?.monitoringUrl ? (
          <a className={LINK_ACCENT} href={confirmResult.nextSteps.monitoringUrl} target="_blank" rel="noreferrer">
            View monitoring dashboard
            <span aria-hidden="true">&rarr;</span>
          </a>
        ) : null}
      </div>
    );
  }, [confirmResult]);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <FormSection as="form" onSubmit={async (event) => {
        event.preventDefault();
        const success = await runPreview();
        if (success) {
          analytics.trackEvent('import_job_bundle_preview_succeeded');
        }
      }}>
        <div className={`${CARD_SECTION} gap-2`}>
          <p className={BODY_TEXT}>
            Upload a job bundle archive or reference a registry entry to validate the manifest before publishing. Archives must
            include <code>manifest.json</code> at the root.
          </p>
          <a className={LINK_ACCENT} href={JOB_DOC_URL} target="_blank" rel="noreferrer">
            Review job bundle format
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={segmentedButtonClass(form.source === 'upload')}
            onClick={() => setFormField('source', 'upload')}
          >
            Upload archive
          </button>
          <button
            type="button"
            className={segmentedButtonClass(form.source === 'registry')}
            onClick={() => setFormField('source', 'registry')}
          >
            Registry reference
          </button>
        </div>
        {form.source === 'upload' ? (
          <FormField label="Bundle archive" htmlFor="bundle-archive">
            <input
              id="bundle-archive"
              type="file"
              accept=".tgz,.tar.gz"
              ref={fileInputRef}
              onChange={handleArchiveChange}
            />
          </FormField>
        ) : (
          <FormField label="Bundle reference" htmlFor="bundle-reference">
            <input
              id="bundle-reference"
              className={INPUT}
              value={form.reference}
              onChange={(event) => setFormField('reference', event.target.value)}
              placeholder="my-job@1.0.0"
              required
            />
          </FormField>
        )}
        <FormField label="Notes (optional)" htmlFor="bundle-notes">
          <textarea
            id="bundle-notes"
            className={TEXTAREA}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="Mention where this bundle came from or why it was updated."
          />
        </FormField>
        <FormActions>
          <FormButton type="submit" disabled={previewLoading || (form.source === 'upload' && !archive)}>
            {previewLoading ? 'Generating preview...' : 'Preview bundle'}
          </FormButton>
          <FormButton type="button" variant="secondary" onClick={handleReset}>
            Reset
          </FormButton>
        </FormActions>
        {previewError ? <FormFeedback tone="error">{previewError}</FormFeedback> : null}
      </FormSection>

      <div className="flex flex-col gap-4">
        {previewLoading ? (
          <div className="flex items-center gap-2 text-scale-sm text-secondary">
            <Spinner size="xs" label="Loading" />
            <span>Generating preview...</span>
          </div>
        ) : null}

        {previewSummary}

        {previewResult ? (
          <FormActions>
            <FormButton
              type="button"
              disabled={!canConfirm || confirmLoading}
              onClick={async () => {
                const success = await confirmImport();
                if (success) {
                  analytics.trackEvent('import_job_bundle_confirmed');
                }
              }}
            >
              {confirmLoading ? 'Importing...' : 'Import bundle'}
            </FormButton>
          </FormActions>
        ) : null}

        {confirmError ? <FormFeedback tone="error">{confirmError}</FormFeedback> : null}
        {confirmSummary}
      </div>
    </div>
  );
}
