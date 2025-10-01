import { useEffect, useMemo, useRef } from 'react';
import {
  FormActions,
  FormButton,
  FormFeedback,
  FormField,
  FormSection
} from '../../components/form';
import { useToasts } from '../../components/toast';
import {
  useImportServiceManifest,
  type ManifestPlaceholder,
  type ManifestPlaceholderOccurrence,
  type ManifestSourceType
} from '../useImportServiceManifest';
import type { ServiceManifestScenario } from '../examples';
import { ScenarioSwitcher } from '../components/ScenarioSwitcher';

const SERVICE_MANIFEST_DOC_URL =
  'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#service-manifests';

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const GRID_SECTION_CLASSES = 'grid gap-4 md:grid-cols-2';

function describePlaceholderUsages(placeholder: ManifestPlaceholder) {
  if (!placeholder.occurrences.length) {
    return '';
  }
  return placeholder.occurrences
    .map((occurrence: ManifestPlaceholderOccurrence) => {
      const { envKey, source } = occurrence;
      switch (occurrence.kind) {
        case 'service':
          return `Service ${occurrence.serviceSlug} · env ${envKey} (source: ${source})`;
        case 'network':
          return `Network ${occurrence.networkId} · env ${envKey} (source: ${source})`;
        case 'network-service':
          return `Network ${occurrence.networkId} → service ${occurrence.serviceSlug} · env ${envKey} (source: ${source})`;
        case 'app-launch':
          return `App ${occurrence.appId} (network ${occurrence.networkId}) · env ${envKey} (source: ${source})`;
        default:
          return `env ${envKey} (source: ${source})`;
      }
    })
    .join('; ');
}

type ServiceManifestsTabProps = {
  onImported?: () => void;
  scenario?: ServiceManifestScenario | null;
  scenarioRequestToken?: number;
  onScenarioCleared?: () => void;
  scenarioOptions?: { id: string; title: string }[];
  activeScenarioId?: string | null;
  onScenarioSelected?: (id: string) => void;
};

export default function ServiceManifestsTab({
  onImported,
  scenario,
  scenarioRequestToken,
  onScenarioCleared,
  scenarioOptions,
  activeScenarioId,
  onScenarioSelected
}: ServiceManifestsTabProps) {
  const {
    form,
    updateField,
    setForm,
    submitting,
    error,
    errorVersion,
    result,
    resultVersion,
    handleSubmit,
    resetResult,
    handleReimport,
    canReimport,
    reimporting,
    placeholders,
    variables,
    updateVariable,
    setVariables
  } = useImportServiceManifest();
  const { pushToast } = useToasts();
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const lastSuccessVersion = useRef(0);
  const lastErrorVersion = useRef(0);

  useEffect(() => {
    if (!scenario || typeof scenarioRequestToken === 'undefined') {
      return;
    }
    const sourceType: ManifestSourceType =
      scenario.form.sourceType === 'image' ? 'image' : 'git';
    setForm({
      sourceType,
      repo: scenario.form.repo ?? '',
      image: scenario.form.image ?? '',
      ref: scenario.form.ref ?? '',
      commit: scenario.form.commit ?? '',
      configPath: scenario.form.configPath ?? '',
      module: scenario.form.module ?? ''
    });
    resetResult();
    setVariables(scenario.form.variables ?? {});
  }, [scenario, scenarioRequestToken, resetResult, setForm, setVariables]);

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
              Resolved reference
            </dt>
            <dd className="text-sm text-slate-700 dark:text-slate-200">
              {result.resolvedCommit ?? 'n/a'}
            </dd>
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
              View in core
            </FormButton>
          )}
        </div>
      </div>
    );
  }, [canReimport, handleReimport, onImported, reimporting, resetResult, result]);

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
                Fields prefilled from <strong>{scenario.title}</strong>. Adjust values or reset to start fresh.
              </p>
              {(scenario.requiresApps?.length || scenario.requiresServices?.length) && (
                <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {scenario.requiresApps?.length ? (
                    <li>
                      <strong>Requires apps:</strong> {scenario.requiresApps.join(', ')}
                    </li>
                  ) : null}
                  {scenario.requiresServices?.length ? (
                    <li>
                      <strong>Requires services:</strong> {scenario.requiresServices.join(', ')}
                    </li>
                  ) : null}
                </ul>
              )}
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
      <ScenarioSwitcher
        options={scenarioOptions ?? []}
        activeId={activeScenarioId ?? null}
        onSelect={onScenarioSelected}
      />
      <FormSection as="form" onSubmit={handleSubmit} aria-label="Import service manifest">
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200">
          <p className="leading-relaxed">
            <strong>Services</strong> define long-lived endpoints and configuration imported from manifests. Supply either a
            Git repository or a Docker image that contains your manifest bundle to register health URLs, environment
            placeholders, and service networks. When you want AppHub to build a container from source, continue with the{' '}
            <span className="font-semibold">Apps</span> tab instead.
          </p>
          <a
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
            href={SERVICE_MANIFEST_DOC_URL}
            target="_blank"
            rel="noreferrer"
          >
            Learn more about service manifests
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <FormField label="Manifest source" htmlFor="manifest-source">
          <select
            id="manifest-source"
            className={INPUT_CLASSES}
            value={form.sourceType}
            onChange={(event) => updateField('sourceType', event.target.value as ManifestSourceType)}
          >
            <option value="git">Git repository</option>
            <option value="image">Docker image</option>
          </select>
        </FormField>
        {form.sourceType === 'git' ? (
          <>
            <FormField label="Service manifest repository" htmlFor="manifest-repo">
              <input
                id="manifest-repo"
                className={INPUT_CLASSES}
                value={form.repo}
                onChange={(event) => updateField('repo', event.target.value)}
                placeholder="https://github.com/user/service-manifest.git"
                required={form.sourceType === 'git'}
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
          </>
        ) : (
          <FormField label="Docker image reference" htmlFor="manifest-image">
            <input
              id="manifest-image"
              className={INPUT_CLASSES}
              value={form.image}
              onChange={(event) => updateField('image', event.target.value)}
              placeholder="registry.example.com/org/service-manifest:latest"
              required={form.sourceType === 'image'}
            />
          </FormField>
        )}
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
        {placeholders.length > 0 && (
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/60 bg-white/70 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-600 dark:text-violet-300">
                Placeholder variables
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Provide values for required placeholders before importing. Optional fields fall back to the manifest
                defaults when left blank.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              {placeholders.map((placeholder) => {
                const normalizedId = placeholder.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
                const inputId = `manifest-variable-${normalizedId}`;
                const label = placeholder.required ? placeholder.name : `${placeholder.name} (optional)`;
                const usage = describePlaceholderUsages(placeholder);
                const value = variables[placeholder.name] ?? '';
                return (
                  <FormField key={placeholder.name} label={label} htmlFor={inputId}>
                    <input
                      id={inputId}
                      className={INPUT_CLASSES}
                      value={value}
                      onChange={(event) => updateVariable(placeholder.name, event.target.value)}
                      required={placeholder.required}
                      placeholder={!placeholder.required && placeholder.defaultValue ? placeholder.defaultValue : undefined}
                    />
                    <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
                      {placeholder.description ? <p>{placeholder.description}</p> : null}
                      {usage ? <p>Used by {usage}</p> : null}
                      {placeholder.defaultValue !== undefined && !placeholder.required ? (
                        <p>Default: {placeholder.defaultValue}</p>
                      ) : null}
                    </div>
                  </FormField>
                );
              })}
            </div>
          </div>
        )}
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
