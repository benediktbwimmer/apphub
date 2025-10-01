import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  FormActions,
  FormButton,
  FormField,
  FormFeedback,
  FormSection
} from '../../components/form';
import { Spinner } from '../../components';
import { useToasts } from '../../components/toast';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useAnalytics } from '../../utils/useAnalytics';
import {
  createWorkflowDefinition,
  listJobDefinitions,
  type JobDefinitionSummary,
  type WorkflowCreateInput
} from '../../workflows/api';
import type { WorkflowDefinition } from '../../workflows/types';
import { ScenarioSwitcher } from '../components/ScenarioSwitcher';
import type { WorkflowScenario } from '../examples';
import {
  BODY_TEXT,
  CARD_SECTION,
  CARD_SURFACE_ACTIVE,
  LINK_ACCENT,
  POSITIVE_SURFACE,
  SECTION_LABEL,
  SECONDARY_BUTTON,
  STATUS_META,
  TEXTAREA
} from '../importTokens';

const JSON_TEXTAREA = `${TEXTAREA} min-h-[320px] font-mono`;

const WORKFLOW_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#workflows';

type DependencyStatus = {
  status: 'idle' | 'checking' | 'valid' | 'invalid';
  missing: string[];
  message: string | null;
  checkedAt: number | null;
};

const INITIAL_DEPENDENCY_STATUS: DependencyStatus = {
  status: 'idle',
  missing: [],
  message: null,
  checkedAt: null
};

function isJobStep(step: WorkflowCreateInput['steps'][number]): step is WorkflowCreateInput['steps'][number] & { jobSlug: string } {
  return Boolean(step && typeof (step as { jobSlug?: unknown }).jobSlug === 'string');
}

function extractJobSlugs(spec: WorkflowCreateInput | null): string[] {
  if (!spec) {
    return [];
  }
  const slugs = spec.steps
    .filter(isJobStep)
    .map((step) => (step as { jobSlug: string }).jobSlug.trim())
    .filter((slug) => slug.length > 0);
  return Array.from(new Set(slugs));
}

type ImportWorkflowTabProps = {
  scenario?: WorkflowScenario | null;
  scenarioRequestToken?: number;
  onScenarioCleared?: () => void;
  scenarioOptions?: { id: string; title: string }[];
  activeScenarioId?: string | null;
  onScenarioSelected?: (id: string) => void;
};

export default function ImportWorkflowTab({
  scenario,
  scenarioRequestToken,
  onScenarioCleared,
  scenarioOptions,
  activeScenarioId,
  onScenarioSelected
}: ImportWorkflowTabProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const { trackEvent } = useAnalytics();
  const [inputText, setInputText] = useState('');
  const [workflowSpec, setWorkflowSpec] = useState<WorkflowCreateInput | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>(INITIAL_DEPENDENCY_STATUS);
  const [jobCore, setJobCore] = useState<JobDefinitionSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<WorkflowDefinition | null>(null);
  const lastScenarioToken = useRef<number | null>(null);

  const requiredJobSlugs = useMemo(() => extractJobSlugs(workflowSpec), [workflowSpec]);
  const hasValidatedDependencies = dependencyStatus.status === 'valid';

  const parseInput = useCallback(
    (raw: string) => {
      if (!raw.trim()) {
        setWorkflowSpec(null);
        setParseError('Provide a workflow JSON payload to continue.');
        return;
      }
      try {
        const parsed = JSON.parse(raw) as WorkflowCreateInput;
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Workflow payload must be an object.');
        }
        if (typeof parsed.slug !== 'string' || parsed.slug.trim().length === 0) {
          throw new Error('Workflow slug is required.');
        }
        if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
          throw new Error('Workflow name is required.');
        }
        if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
          throw new Error('Define at least one workflow step.');
        }
        setWorkflowSpec(parsed);
        setParseError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid workflow JSON payload.';
        setWorkflowSpec(null);
        setParseError(message);
      }
    },
    []
  );

  useEffect(() => {
    if (!scenario || typeof scenarioRequestToken === 'undefined') {
      return;
    }
    if (lastScenarioToken.current === scenarioRequestToken) {
      return;
    }
    lastScenarioToken.current = scenarioRequestToken;
    const formatted = JSON.stringify(scenario.form, null, 2);
    setInputText(formatted);
    parseInput(formatted);
    setDependencyStatus(INITIAL_DEPENDENCY_STATUS);
    setImportResult(null);
    setImportError(null);
  }, [parseInput, scenario, scenarioRequestToken]);

  const fetchJobCore = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const jobs = await listJobDefinitions(authorizedFetch);
      setJobCore(jobs);
      return jobs;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load job core.';
      setJobsError(message);
      throw err;
    } finally {
      setJobsLoading(false);
    }
  }, [authorizedFetch]);

  const ensureJobCore = useCallback(async () => {
    if (jobCore.length > 0) {
      return jobCore;
    }
    return fetchJobCore();
  }, [fetchJobCore, jobCore]);

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setInputText(value);
    parseInput(value);
    setDependencyStatus(INITIAL_DEPENDENCY_STATUS);
    setImportResult(null);
    setImportError(null);
  };

  const handleValidateDependencies = useCallback(async () => {
    if (!workflowSpec) {
      setDependencyStatus({
        status: 'invalid',
        missing: [],
        message: 'Resolve JSON parse errors before validating dependencies.',
        checkedAt: Date.now()
      });
      return;
    }
    setDependencyStatus({ status: 'checking', missing: [], message: null, checkedAt: null });
    try {
      const jobs = await ensureJobCore();
      const missing = requiredJobSlugs.filter((slug) => !jobs.some((job) => job.slug === slug));
      if (missing.length > 0) {
        setDependencyStatus({
          status: 'invalid',
          missing,
          message: 'Register the missing job definitions before importing the workflow.',
          checkedAt: Date.now()
        });
        return;
      }
      setDependencyStatus({
        status: 'valid',
        missing: [],
        message: `All ${requiredJobSlugs.length || 0} job dependencies resolved.`,
        checkedAt: Date.now()
      });
      trackEvent('workflow_import_dependencies_validated', {
        workflowSlug: workflowSpec.slug,
        jobDependencyCount: requiredJobSlugs.length
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : jobsError ?? 'Failed to load job core.';
      setDependencyStatus({
        status: 'invalid',
        missing: [],
        message,
        checkedAt: Date.now()
      });
    }
  }, [ensureJobCore, jobsError, requiredJobSlugs, trackEvent, workflowSpec]);

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!workflowSpec) {
      setImportError('Resolve JSON parse errors before importing.');
      return;
    }
    if (!hasValidatedDependencies) {
      setImportError('Validate dependencies and resolve missing jobs before importing.');
      return;
    }
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const result = await createWorkflowDefinition(authorizedFetch, workflowSpec);
      setImportResult(result);
      pushToast({
        tone: 'success',
        title: 'Workflow imported',
        description: `Created workflow ${result.slug}.`
      });
      trackEvent('workflow_import_created', {
        workflowSlug: result.slug,
        stepCount: result.steps.length,
        triggerCount: result.triggers.length
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import workflow.';
      setImportError(message);
    } finally {
      setImporting(false);
    }
  };

  const workflowSummary = useMemo(() => {
    if (!workflowSpec) {
      return null;
    }
    return {
      slug: workflowSpec.slug,
      name: workflowSpec.name,
      version: workflowSpec.version ?? 1,
      stepCount: workflowSpec.steps.length,
      triggerCount: Array.isArray(workflowSpec.triggers) ? workflowSpec.triggers.length : 0
    };
  }, [workflowSpec]);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {scenario ? (
        <div className={`${CARD_SECTION} ${CARD_SURFACE_ACTIVE} gap-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className={`flex flex-col gap-1 ${BODY_TEXT}`}>
              <span className={SECTION_LABEL}>Example scenario active</span>
              <p>
                Workflow payload sourced from <strong>{scenario.title}</strong>. Review the JSON, adjust parameters, and validate dependencies before importing.
              </p>
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

      <FormSection as="form" onSubmit={handleImport} aria-label="Import workflow definition">
        <FormField
          label="Workflow definition (JSON)"
          hint={
            <span className={STATUS_META}>
              Use
              {' '}
              <a className={LINK_ACCENT} href={WORKFLOW_DOC_URL} target="_blank" rel="noreferrer">
                the workflow guide
              </a>
              {' '}
              for field reference.
            </span>
          }
        >
          <textarea value={inputText} onChange={handleInputChange} className={JSON_TEXTAREA} spellCheck={false} />
        </FormField>

        {parseError ? (
          <FormFeedback tone="error">{parseError}</FormFeedback>
        ) : null}

        {dependencyStatus.status === 'checking' ? (
          <FormFeedback tone="info">
            <div className="flex items-center gap-2">
              <Spinner size="sm" label="Checking job dependencies" />
              <span>Checking job dependencies…</span>
            </div>
          </FormFeedback>
        ) : null}

        {dependencyStatus.status === 'valid' ? (
          <FormFeedback tone="success">{dependencyStatus.message}</FormFeedback>
        ) : null}

        {dependencyStatus.status === 'invalid' && dependencyStatus.message ? (
          <FormFeedback tone="error">
            <div className="flex flex-col gap-2">
              <span>{dependencyStatus.message}</span>
              {dependencyStatus.missing.length > 0 ? (
                <ul className={`list-disc space-y-1 pl-5 ${BODY_TEXT}`}>
                  {dependencyStatus.missing.map((slug) => (
                    <li key={slug}>{slug}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </FormFeedback>
        ) : null}

        {jobsError && dependencyStatus.status === 'idle' ? (
          <FormFeedback tone="error">{jobsError}</FormFeedback>
        ) : null}

        {importError ? <FormFeedback tone="error">{importError}</FormFeedback> : null}

        <FormActions>
          <FormButton
            type="button"
            variant="secondary"
            onClick={handleValidateDependencies}
            disabled={jobsLoading || parseError !== null || importing}
          >
            {jobsLoading || dependencyStatus.status === 'checking' ? 'Validating…' : 'Check dependencies'}
          </FormButton>
          <FormButton type="submit" disabled={!workflowSpec || importing || !hasValidatedDependencies}>
            {importing ? 'Importing…' : 'Import workflow'}
          </FormButton>
        </FormActions>
      </FormSection>

      <div className={`${CARD_SECTION} gap-4 text-scale-sm`}>
        <div className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>Workflow preview</span>
          {workflowSummary ? (
            <ul className={`space-y-1 ${BODY_TEXT}`}>
              <li>
                <strong className="font-weight-semibold text-primary">Slug:</strong> {workflowSummary.slug}
              </li>
              <li>
                <strong className="font-weight-semibold text-primary">Name:</strong> {workflowSummary.name}
              </li>
              <li>
                <strong className="font-weight-semibold text-primary">Version:</strong> {workflowSummary.version}
              </li>
              <li>
                <strong className="font-weight-semibold text-primary">Steps:</strong> {workflowSummary.stepCount}
              </li>
              <li>
                <strong className="font-weight-semibold text-primary">Triggers:</strong> {workflowSummary.triggerCount}
              </li>
              <li>
                <strong className="font-weight-semibold text-primary">Job dependencies:</strong>{' '}
                {requiredJobSlugs.length > 0 ? requiredJobSlugs.join(', ') : 'None'}
              </li>
            </ul>
          ) : (
            <p className={BODY_TEXT}>Paste a workflow JSON payload to see a preview.</p>
          )}
        </div>

        {importResult ? (
          <div className={POSITIVE_SURFACE}>
            <span className={SECTION_LABEL}>Workflow created</span>
            <ul className="flex flex-col gap-1 text-scale-sm">
              <li>
                <strong>Slug:</strong> {importResult.slug}
              </li>
              <li>
                <strong>Version:</strong> {importResult.version}
              </li>
              <li>
                <strong>Steps:</strong> {importResult.steps.length}
              </li>
              <li>
                <strong>Triggers:</strong> {importResult.triggers.length}
              </li>
              <li>
                <strong>Created at:</strong> {new Date(importResult.createdAt).toLocaleString()}
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
