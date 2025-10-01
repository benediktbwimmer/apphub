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
import {
  BODY_TEXT,
  CARD_SECTION,
  CARD_SURFACE_ACTIVE,
  HEADING_SECONDARY,
  INPUT,
  LINK_ACCENT,
  SECTION_LABEL,
  SECONDARY_BUTTON,
  STATUS_META
} from '../importTokens';

const SERVICE_MANIFEST_DOC_URL =
  'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#service-manifests';

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
      <div ref={summaryRef} className={`${CARD_SECTION} ${CARD_SURFACE_ACTIVE} gap-4`}>
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Import completed</span>
          <span className={HEADING_SECONDARY}>{result.module}</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Resolved reference</dt>
            <dd className={BODY_TEXT}>{result.resolvedCommit ?? 'n/a'}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Services discovered</dt>
            <dd className={BODY_TEXT}>{result.servicesDiscovered}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className={SECTION_LABEL}>Service networks</dt>
            <dd className={BODY_TEXT}>{result.networksDiscovered}</dd>
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
        <div className={`${CARD_SECTION} ${CARD_SURFACE_ACTIVE} gap-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className={`flex flex-col gap-1 ${BODY_TEXT}`}>
              <span className={SECTION_LABEL}>Example scenario active</span>
              <p>
                Fields prefilled from <strong>{scenario.title}</strong>. Adjust values or reset to start fresh.
              </p>
              {(scenario.requiresApps?.length || scenario.requiresServices?.length) && (
                <ul className={`mt-1 space-y-1 ${STATUS_META}`}>
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
            {onScenarioCleared ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={onScenarioCleared}>
                Reset
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ScenarioSwitcher
        options={scenarioOptions ?? []}
        activeId={activeScenarioId ?? null}
        onSelect={onScenarioSelected}
      />
      <FormSection as="form" onSubmit={handleSubmit} aria-label="Import service manifest">
        <div className={`${CARD_SECTION} gap-2`}>
          <p className={BODY_TEXT}>
            <strong>Services</strong> define long-lived endpoints and configuration imported from manifests. Supply either a
            Git repository or a Docker image that contains your manifest bundle to register health URLs, environment
            placeholders, and service networks. When you want AppHub to build a container from source, continue with the{' '}
            <span className="font-weight-semibold text-primary">Apps</span> tab instead.
          </p>
          <a className={LINK_ACCENT} href={SERVICE_MANIFEST_DOC_URL} target="_blank" rel="noreferrer">
            Learn more about service manifests
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <FormField label="Manifest source" htmlFor="manifest-source">
          <select
            id="manifest-source"
            className={INPUT}
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
                className={INPUT}
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
                  className={INPUT}
                  value={form.ref}
                  onChange={(event) => updateField('ref', event.target.value)}
                  placeholder="main"
                />
              </FormField>
              <FormField label="Commit SHA (optional)" htmlFor="manifest-commit">
                <input
                  id="manifest-commit"
                  className={INPUT}
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
              className={INPUT}
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
              className={INPUT}
              value={form.configPath}
              onChange={(event) => updateField('configPath', event.target.value)}
              placeholder="service-config.json"
            />
          </FormField>
          <FormField label="Module name (optional)" htmlFor="manifest-module">
            <input
              id="manifest-module"
              className={INPUT}
              value={form.module}
              onChange={(event) => updateField('module', event.target.value)}
              placeholder="github.com/user/module"
            />
          </FormField>
        </div>
        {placeholders.length > 0 && (
          <div className={`${CARD_SECTION} gap-4`}>
            <div className="flex flex-col gap-1">
              <span className={SECTION_LABEL}>Placeholder variables</span>
              <p className={STATUS_META}>
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
                      className={INPUT}
                      value={value}
                      onChange={(event) => updateVariable(placeholder.name, event.target.value)}
                      required={placeholder.required}
                      placeholder={!placeholder.required && placeholder.defaultValue ? placeholder.defaultValue : undefined}
                    />
                    <div className={`mt-2 flex flex-col gap-1 ${STATUS_META}`}>
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
        <h2 className={HEADING_SECONDARY}>Import status</h2>
        {!result && !error && (
          <div className={`${CARD_SECTION} gap-2`}>
            <p className={BODY_TEXT}>
              AppHub validates repository access and manifest schema before applying changes. Provide a Git repository
              to preview discovered services and service networks prior to committing the manifest.
            </p>
            <a className={LINK_ACCENT} href={SERVICE_MANIFEST_DOC_URL} target="_blank" rel="noreferrer">
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
