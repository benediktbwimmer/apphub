import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
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
import {
  BODY_TEXT,
  CARD_SECTION,
  HEADING_SECONDARY,
  LINK_ACCENT,
  POSITIVE_SURFACE,
  SECTION_LABEL,
  STATUS_MESSAGE,
  TEXTAREA
} from '../importTokens';

const JSON_TEXTAREA = `${TEXTAREA} min-h-[320px] font-mono`;

const WORKFLOW_DOC_URL = 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#workflows';

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

export default function ImportWorkflowTab() {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const { trackEvent } = useAnalytics();
  const [inputText, setInputText] = useState('');
  const [workflowSpec, setWorkflowSpec] = useState<WorkflowCreateInput | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [missingDependencies, setMissingDependencies] = useState<string[]>([]);
  const [dependencyMessage, setDependencyMessage] = useState<string | null>(null);
  const [dependencyCheckedAt, setDependencyCheckedAt] = useState<number | null>(null);
  const [jobCore, setJobCore] = useState<JobDefinitionSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<WorkflowDefinition | null>(null);
  const lastValidatedPayload = useRef<string | null>(null);

  const requiredJobSlugs = useMemo(() => extractJobSlugs(workflowSpec), [workflowSpec]);

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
        setDependencyStatus('idle');
        setDependencyMessage(null);
        setMissingDependencies([]);
        setDependencyCheckedAt(null);
        setImportResult(null);
        setImportError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid workflow JSON payload.';
        setWorkflowSpec(null);
        setParseError(message);
      }
    },
    []
  );

  const fetchJobCore = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const jobs = await listJobDefinitions(authorizedFetch);
      setJobCore(jobs);
      return jobs;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load job catalog.';
      setJobsError(message);
      throw err;
    } finally {
      setJobsLoading(false);
    }
  }, [authorizedFetch]);

  const validateDependencies = useCallback(async () => {
    if (!workflowSpec) {
      return;
    }
    setDependencyStatus('checking');
    setDependencyMessage(null);
    setMissingDependencies([]);

    try {
      const jobs = jobCore.length > 0 ? jobCore : await fetchJobCore();
      const available = new Set(jobs.map((job) => job.slug));
      const missing = requiredJobSlugs.filter((slug) => !available.has(slug));
      setMissingDependencies(missing);
      setDependencyStatus(missing.length === 0 ? 'valid' : 'invalid');
      setDependencyMessage(missing.length === 0 ? null : 'Register the missing jobs before enabling this workflow.');
      setDependencyCheckedAt(Date.now());
      lastValidatedPayload.current = JSON.stringify(workflowSpec);
    } catch (err) {
      setDependencyStatus('invalid');
      setDependencyMessage((err as Error).message);
    }
  }, [fetchJobCore, jobCore, requiredJobSlugs, workflowSpec]);

  const handleImport = useCallback(async () => {
    if (!workflowSpec) {
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const payload = await createWorkflowDefinition(authorizedFetch, workflowSpec);
      setImportResult(payload);
      trackEvent('import_workflow_definition.succeeded');
      pushToast({
        tone: 'success',
        title: 'Workflow imported',
        description: `${payload.slug} is available in the catalog.`
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import workflow.';
      setImportError(message);
      trackEvent('import_workflow_definition.failed');
    } finally {
      setImporting(false);
    }
  }, [authorizedFetch, pushToast, trackEvent, workflowSpec]);

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInputText(value);
    parseInput(value);
  };

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <FormSection aria-label="Workflow definition">
        <div className={`${CARD_SECTION} gap-2`}>
          <p className={BODY_TEXT}>
            Paste a workflow definition JSON payload. Validate job dependencies before importing to ensure referenced job
            slugs exist in the catalog.
          </p>
          <a className={LINK_ACCENT} href={WORKFLOW_DOC_URL} target="_blank" rel="noreferrer">
            Review workflow requirements
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        <FormField label="Workflow JSON" htmlFor="workflow-json">
          <textarea
            id="workflow-json"
            className={JSON_TEXTAREA}
            value={inputText}
            onChange={handleTextChange}
            placeholder='{"slug": "observatory-minute-ingest", "steps": [...]}'
          />
        </FormField>
        {parseError ? <FormFeedback tone="error">{parseError}</FormFeedback> : null}
        <FormActions>
          <FormButton
            type="button"
            variant="secondary"
            onClick={() => {
              setInputText('');
              parseInput('');
            }}
          >
            Clear
          </FormButton>
          <FormButton
            type="button"
            onClick={validateDependencies}
            disabled={!workflowSpec || requiredJobSlugs.length === 0 || dependencyStatus === 'checking'}
          >
            {dependencyStatus === 'checking' ? 'Validating...' : 'Validate dependencies'}
          </FormButton>
          <FormButton
            type="button"
            disabled={!workflowSpec || importing || dependencyStatus === 'checking'}
            onClick={handleImport}
          >
            {importing ? 'Importing...' : 'Import workflow'}
          </FormButton>
        </FormActions>
        {dependencyStatus !== 'idle' ? (
          <div className={`${CARD_SECTION} gap-2`}>
            <span className={SECTION_LABEL}>Dependency status</span>
            {dependencyStatus === 'checking' ? (
              <div className="flex items-center gap-2 text-scale-sm text-secondary">
                <Spinner size="xs" label="Validating" />
                <span>Checking job dependencies...</span>
              </div>
            ) : dependencyStatus === 'valid' ? (
              <p className={BODY_TEXT}>All referenced job slugs are registered.</p>
            ) : (
              <div className="flex flex-col gap-1 text-scale-sm text-secondary">
                <p>{dependencyMessage ?? 'Unable to verify job dependencies.'}</p>
                {missingDependencies.length > 0 ? (
                  <p>Missing jobs: {missingDependencies.join(', ')}</p>
                ) : null}
              </div>
            )}
            {dependencyCheckedAt ? (
              <p className={STATUS_MESSAGE}>Last checked {new Date(dependencyCheckedAt).toLocaleString()}</p>
            ) : null}
          </div>
        ) : null}
        {importError ? <FormFeedback tone="error">{importError}</FormFeedback> : null}
        {jobsError ? <FormFeedback tone="error">{jobsError}</FormFeedback> : null}
      </FormSection>

      <div className="flex flex-col gap-4">
        {jobsLoading ? (
          <div className="flex items-center gap-2 text-scale-sm text-secondary">
            <Spinner size="xs" label="Loading" />
            <span>Loading job catalog...</span>
          </div>
        ) : null}

        {workflowSpec ? (
          <div className={`${CARD_SECTION} gap-2`}>
            <span className={SECTION_LABEL}>Parsed payload</span>
            <JsonSyntaxHighlighter value={JSON.stringify(workflowSpec, null, 2)} />
          </div>
        ) : null}

        {importResult ? (
          <div className={POSITIVE_SURFACE}>
            <div className="flex flex-col gap-1">
              <span className={SECTION_LABEL}>Workflow imported</span>
              <h3 className={HEADING_SECONDARY}>{importResult.slug}</h3>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className={SECTION_LABEL}>Display name</dt>
                <dd>{importResult.name}</dd>
              </div>
              <div>
                <dt className={SECTION_LABEL}>Version</dt>
                <dd>{importResult.version}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
