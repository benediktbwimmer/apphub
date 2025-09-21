import { useEffect, useMemo, useRef } from 'react';
import { type Dispatch, type SetStateAction } from 'react';
import {
  FormActions,
  FormButton,
  FormFeedback,
  FormField,
  FormSection
} from '../../components/form';
import { useToasts } from '../../components/toast';
import { useImportServiceManifest } from '../useImportServiceManifest';
import { type ImportSubtab, type ImportWorkspaceNavigation } from '../ImportWorkspace';

const SERVICE_MANIFEST_DOC_URL =
  'https://github.com/apphub-osiris/apphub/blob/main/docs/architecture.md#service-manifests';

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const GRID_SECTION_CLASSES = 'grid gap-4 md:grid-cols-2';

type ServiceManifestsTabProps = {
  onImported?: () => void;
  setActiveSubtab: Dispatch<SetStateAction<ImportSubtab>>;
  activeSubtab: ImportSubtab;
  navigation: ImportWorkspaceNavigation;
};

export default function ServiceManifestsTab({ onImported }: ServiceManifestsTabProps) {
  const {
    form,
    updateField,
    submitting,
    error,
    errorVersion,
    result,
    resultVersion,
    handleSubmit,
    resetResult,
    handleReimport,
    canReimport,
    reimporting
  } = useImportServiceManifest();
  const { pushToast } = useToasts();
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const lastSuccessVersion = useRef(0);
  const lastErrorVersion = useRef(0);

  useEffect(() => {
    if (!result) {
      return;
    }
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  useEffect(() => {
    if (!result || resultVersion === lastSuccessVersion.current) {
      return;
    }
    const serviceLabel = result.servicesDiscovered === 1 ? 'service' : 'services';
    const networkLabel = result.networksDiscovered === 1 ? 'network' : 'networks';
    const description = `Imported ${result.servicesDiscovered} ${serviceLabel} and ${result.networksDiscovered} ${networkLabel}.`;
    pushToast({
      tone: 'success',
      title: 'Service manifest imported',
      description
    });
    lastSuccessVersion.current = resultVersion;
  }, [pushToast, result, resultVersion]);

  useEffect(() => {
    if (!error || errorVersion === lastErrorVersion.current) {
      return;
    }
    pushToast({ tone: 'error', title: 'Manifest import failed', description: error });
    lastErrorVersion.current = errorVersion;
  }, [error, errorVersion, pushToast]);

  const importSummary = useMemo(() => {
    if (!result) {
      return null;
    }

    return (
      <div
        ref={summaryRef}
        className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60"
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500 dark:text-emerald-300">
            Import completed
          </span>
          <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{result.module}</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Resolved commit
            </dt>
            <dd className="text-sm text-slate-700 dark:text-slate-200">
              {result.resolvedCommit ?? 'n/a'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Config path
            </dt>
            <dd className="text-sm text-slate-700 dark:text-slate-200">{result.configPath}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Services discovered
            </dt>
            <dd className="text-sm text-slate-700 dark:text-slate-200">{result.servicesDiscovered}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Service networks
            </dt>
            <dd className="text-sm text-slate-700 dark:text-slate-200">{result.networksDiscovered}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <FormButton variant="secondary" size="sm" type="button" onClick={resetResult}>
            Import another manifest
          </FormButton>
          {canReimport && (
            <FormButton
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleReimport}
              disabled={reimporting}
            >
              {reimporting ? 'Re-running…' : 'Re-run import'}
            </FormButton>
          )}
          {onImported && (
            <FormButton
              type="button"
              size="sm"
              onClick={() => {
                onImported();
              }}
            >
              View in catalog
            </FormButton>
          )}
        </div>
      </div>
    );
  }, [canReimport, handleReimport, onImported, reimporting, resetResult, result]);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <FormSection as="form" onSubmit={handleSubmit} aria-label="Import service manifest">
        <FormField label="Service manifest repository" htmlFor="manifest-repo">
          <input
            id="manifest-repo"
            className={INPUT_CLASSES}
            value={form.repo}
            onChange={(event) => updateField('repo', event.target.value)}
            placeholder="https://github.com/user/service-manifest.git"
            required
          />
        </FormField>
        <div className={GRID_SECTION_CLASSES}>
          <FormField label="Git ref (optional)" htmlFor="manifest-ref">
            <input
              id="manifest-ref"
              className={INPUT_CLASSES}
              value={form.ref}
              onChange={(event) => updateField('ref', event.target.value)}
              placeholder="main"
            />
          </FormField>
          <FormField label="Commit SHA (optional)" htmlFor="manifest-commit">
            <input
              id="manifest-commit"
              className={INPUT_CLASSES}
              value={form.commit}
              onChange={(event) => updateField('commit', event.target.value)}
              placeholder="abcdef123456"
            />
          </FormField>
        </div>
        <div className={GRID_SECTION_CLASSES}>
          <FormField label="Config path (optional)" htmlFor="manifest-config-path">
            <input
              id="manifest-config-path"
              className={INPUT_CLASSES}
              value={form.configPath}
              onChange={(event) => updateField('configPath', event.target.value)}
              placeholder="service-config.json"
            />
          </FormField>
          <FormField label="Module name (optional)" htmlFor="manifest-module">
            <input
              id="manifest-module"
              className={INPUT_CLASSES}
              value={form.module}
              onChange={(event) => updateField('module', event.target.value)}
              placeholder="github.com/user/module"
            />
          </FormField>
        </div>
        <FormActions>
          <FormButton type="submit" disabled={submitting}>
            {submitting ? 'Importing…' : 'Import service manifest'}
          </FormButton>
        </FormActions>
        {error && (
          <FormFeedback tone="error">
            {typeof error === 'string' ? error : 'Import failed. Check the repository details and try again.'}
          </FormFeedback>
        )}
      </FormSection>

      <FormSection>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Import status</h2>
        {!result && !error && (
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
            <p>
              AppHub validates repository access and manifest schema before applying changes. Provide a Git repository
              to preview discovered services and service networks prior to committing the manifest.
            </p>
            <a
              className="inline-flex items-center gap-1 text-sm font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
              href={SERVICE_MANIFEST_DOC_URL}
              target="_blank"
              rel="noreferrer"
            >
              Review service manifest guide
              <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
        {importSummary}
      </FormSection>
    </div>
  );
}
