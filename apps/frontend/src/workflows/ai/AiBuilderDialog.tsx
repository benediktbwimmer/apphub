import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ChangeEvent
} from 'react';
import {
  workflowDefinitionCreateSchema,
  jobDefinitionCreateSchema
} from '@apphub/workflow-schemas';
import type { ZodIssue } from 'zod';
import { requestAiSuggestion, type AiBuilderMode } from './api';
import {
  createWorkflowDefinition,
  type AuthorizedFetch,
  type WorkflowCreateInput,
  type JobDefinitionCreateInput,
  type JobDefinitionSummary
} from '../api';
import type { WorkflowDefinition } from '../types';
import { useWorkflowResources } from '../WorkflowResourcesContext';
import type { ToastPayload } from '../../components/toast/ToastContext';
import { createJobWithBundle, type AiBundleSuggestion } from './api';

const WORKFLOW_SCHEMA = workflowDefinitionCreateSchema;
const JOB_SCHEMA = jobDefinitionCreateSchema;

function toValidationErrors(mode: AiBuilderMode, editorValue: string): { valid: boolean; errors: string[] } {
  if (!editorValue.trim()) {
    return { valid: false, errors: [] };
  }
  try {
    const parsed = JSON.parse(editorValue) as unknown;
    const schema = mode === 'workflow' ? WORKFLOW_SCHEMA : JOB_SCHEMA;
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: result.error.errors.map((issue: ZodIssue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message}`;
      })
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON payload';
    return { valid: false, errors: [`Invalid JSON: ${message}`] };
  }
}

function formatSummary(summary: string): string {
  return summary.trim() || 'No catalog metadata summary available.';
}

type AiBuilderDialogProps = {
  open: boolean;
  onClose: () => void;
  authorizedFetch: AuthorizedFetch;
  pushToast: (toast: ToastPayload) => void;
  onWorkflowSubmitted: (workflow: WorkflowDefinition) => Promise<void> | void;
  onWorkflowPrefill: (spec: WorkflowCreateInput) => void;
  canCreateJob: boolean;
};

export default function AiBuilderDialog({
  open,
  onClose,
  authorizedFetch,
  pushToast,
  onWorkflowSubmitted,
  onWorkflowPrefill,
  canCreateJob
}: AiBuilderDialogProps) {
  const { refresh: refreshResources } = useWorkflowResources();
  const [mode, setMode] = useState<'workflow' | 'job'>('workflow');
  const [prompt, setPrompt] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataSummary, setMetadataSummary] = useState('');
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [editorValue, setEditorValue] = useState('');
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] }>({ valid: false, errors: [] });
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [baselineValue, setBaselineValue] = useState('');
  const [bundleSuggestion, setBundleSuggestion] = useState<AiBundleSuggestion | null>(null);
  const [bundleValidation, setBundleValidation] = useState<{ valid: boolean; errors: string[] }>({
    valid: true,
    errors: []
  });

  useEffect(() => {
    if (!open) {
      setMode('workflow');
      setPrompt('');
      setAdditionalNotes('');
      setPending(false);
      setError(null);
      setMetadataSummary('');
      setStdout('');
      setStderr('');
      setEditorValue('');
      setBaselineValue('');
      setValidation({ valid: false, errors: [] });
      setHasSuggestion(false);
      setSubmitting(false);
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValidation(toValidationErrors(mode, editorValue));
  }, [mode, editorValue, open]);

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!prompt.trim()) {
        setError('Describe the workflow or job you would like to generate.');
        return;
      }
      setPending(true);
      setError(null);
      const requestMode: AiBuilderMode = mode === 'job' ? 'job-with-bundle' : 'workflow';
      try {
        const response = await requestAiSuggestion(authorizedFetch, {
          mode: requestMode,
          prompt: prompt.trim(),
          additionalNotes: additionalNotes.trim() || undefined
        });
        setMetadataSummary(response.metadataSummary ?? '');
        setStdout(response.stdout ?? '');
        setStderr(response.stderr ?? '');
        const initialValue = response.suggestion
          ? JSON.stringify(response.suggestion, null, 2)
          : (response.raw ?? '').trim();
        setEditorValue(initialValue);
        setBaselineValue(initialValue);
        setHasSuggestion(true);
        setValidation(toValidationErrors(mode, initialValue));
        setBundleSuggestion((response.bundle as AiBundleSuggestion | null) ?? null);
        setBundleValidation(
          response.bundleValidation ?? {
            valid: true,
            errors: []
          }
        );
        console.info('ai-builder.usage', {
          event: 'generated',
          mode: requestMode,
          promptLength: prompt.trim().length
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate suggestion';
        setError(message);
        console.error('ai-builder.error', { event: 'generate', message, mode: requestMode, error: err });
      } finally {
        setPending(false);
      }
    },
    [authorizedFetch, mode, prompt, additionalNotes]
  );

  const handleModeChange = useCallback(
    (nextMode: AiBuilderMode) => {
      const normalizedMode = nextMode === 'job-with-bundle' ? 'job' : nextMode;
      setMode(normalizedMode);
      setHasSuggestion(false);
      setEditorValue('');
      setBaselineValue('');
      setValidation({ valid: false, errors: [] });
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
      console.info('ai-builder.usage', { event: 'mode-changed', mode: normalizedMode });
    },
    []
  );

  const handleEditorChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setEditorValue(event.target.value);
  };

  const isEdited = useMemo(() => {
    if (!hasSuggestion) {
      return false;
    }
    return baselineValue.trim() !== editorValue.trim();
  }, [baselineValue, editorValue, hasSuggestion]);

  const parseEditorValue = useCallback((): WorkflowCreateInput | JobDefinitionCreateInput | null => {
    if (!editorValue.trim()) {
      return null;
    }
    try {
      const json = JSON.parse(editorValue) as unknown;
      const schema = mode === 'workflow' ? WORKFLOW_SCHEMA : JOB_SCHEMA;
      const result = schema.parse(json);
      return result as WorkflowCreateInput | JobDefinitionCreateInput;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setError(message);
      setValidation(toValidationErrors(mode, editorValue));
      return null;
    }
  }, [editorValue, mode]);

  const handleSubmitWorkflow = useCallback(async () => {
    const parsed = parseEditorValue() as WorkflowCreateInput | null;
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createWorkflowDefinition(authorizedFetch, parsed);
      console.info('ai-builder.usage', {
        event: 'workflow-submitted',
        edited: isEdited,
        mode,
        validationErrors: validation.errors.length
      });
      await onWorkflowSubmitted(created);
      pushToast({
        tone: 'success',
        title: 'Workflow created',
        description: `${created.name} registered successfully.`
      });
      refreshResources();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create workflow';
      setError(message);
      console.error('ai-builder.error', { event: 'workflow-submit', message, mode, error: err });
    } finally {
      setSubmitting(false);
    }
  }, [
    authorizedFetch,
    parseEditorValue,
    isEdited,
    mode,
    validation.errors.length,
    onWorkflowSubmitted,
    pushToast,
    refreshResources,
    onClose
  ]);

  const handleOpenInBuilder = useCallback(() => {
    const parsed = parseEditorValue() as WorkflowCreateInput | null;
    if (!parsed) {
      return;
    }
    console.info('ai-builder.usage', {
      event: 'workflow-prefill',
      edited: isEdited,
      mode
    });
    onWorkflowPrefill(parsed);
    onClose();
  }, [parseEditorValue, isEdited, mode, onWorkflowPrefill, onClose]);

  const handleSubmitJob = useCallback(async () => {
    if (!canCreateJob) {
      setError('Your token must include the job-bundles:write scope to create Codex-generated jobs.');
      return;
    }
    const parsed = parseEditorValue() as JobDefinitionCreateInput | null;
    if (!parsed) {
      return;
    }
    if (!bundleSuggestion) {
      setError('Bundle suggestion missing. Regenerate before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const jobPayload: JobDefinitionCreateInput = {
        ...parsed,
        entryPoint: `bundle:${bundleSuggestion.slug}@${bundleSuggestion.version}`
      };
      const created: JobDefinitionSummary = (
        await createJobWithBundle(authorizedFetch, {
          job: jobPayload,
          bundle: bundleSuggestion
        })
      ).job;
      console.info('ai-builder.usage', {
        event: 'job-submitted',
        edited: isEdited,
        mode,
        jobSlug: created.slug
      });
      pushToast({
        tone: 'success',
        title: 'Job created',
        description: `${created.name} registered successfully.`
      });
      refreshResources();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create job';
      setError(message);
      console.error('ai-builder.error', { event: 'job-submit', message, mode, error: err });
    } finally {
      setSubmitting(false);
    }
  }, [
    authorizedFetch,
    parseEditorValue,
    isEdited,
    mode,
    pushToast,
    refreshResources,
    onClose,
    bundleSuggestion,
    canCreateJob
  ]);

  const handleDismiss = useCallback(() => {
    if (hasSuggestion) {
      console.info('ai-builder.usage', {
        event: 'dismissed',
        mode,
        edited: isEdited
      });
    }
    onClose();
  }, [hasSuggestion, mode, isEdited, onClose]);

  if (!open) {
    return null;
  }

  const canSubmit =
    validation.valid &&
    !pending &&
    !submitting &&
    editorValue.trim().length > 0 &&
    (mode === 'job' ? Boolean(bundleSuggestion) && bundleValidation.valid && canCreateJob : true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 p-6 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI Workflow Builder</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Describe the automation you need and let Codex draft a job or workflow definition.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-full border border-slate-200/80 bg-white p-1 text-xs font-semibold shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
              <button
                type="button"
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  mode === 'workflow'
                    ? 'bg-violet-600 text-white shadow'
                    : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                }`}
                onClick={() => handleModeChange('workflow')}
              >
                Workflow
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  mode === 'job'
                    ? 'bg-violet-600 text-white shadow'
                    : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                }`}
                onClick={() => handleModeChange('job')}
              >
                Job
              </button>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-300"
              onClick={handleDismiss}
            >
              Close
            </button>
          </div>
        </header>

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[360px_1fr]">
          <section className="flex flex-col gap-4">
            <form className="flex flex-1 flex-col gap-4" onSubmit={handleGenerate}>
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Describe the automation
                <textarea
                  className="h-40 rounded-2xl border border-slate-200/70 bg-white/80 p-3 text-sm font-normal text-slate-800 shadow-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
                  placeholder="Example: Build a workflow that validates service health and triggers the ai-orchestrator job when repositories are ingested."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={pending || submitting}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Additional notes (optional)
                <textarea
                  className="h-24 rounded-2xl border border-slate-200/70 bg-white/80 p-3 text-sm font-normal text-slate-800 shadow-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
                  placeholder="Constraints, secrets, manual review requirements…"
                  value={additionalNotes}
                  onChange={(event) => setAdditionalNotes(event.target.value)}
                  disabled={pending || submitting}
                />
              </label>

              {error && (
                <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  {error}
                </div>
              )}

              <div className="mt-auto flex items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={pending || submitting}
                >
                  {pending ? 'Generating…' : 'Generate suggestion'}
                </button>
                {hasSuggestion && (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200"
                    onClick={() => handleGenerate()}
                    disabled={pending || submitting}
                  >
                    Regenerate
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Suggestion Preview
              </h3>
              {hasSuggestion && (
                <span
                  className={`text-xs font-semibold ${
                    validation.valid ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'
                  }`}
                >
                  {validation.valid ? 'Schema valid' : 'Needs fixes'}
                </span>
              )}
            </div>

            <textarea
              className="min-h-[320px] flex-1 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 font-mono text-xs text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
              value={editorValue}
              onChange={handleEditorChange}
              spellCheck={false}
              disabled={!hasSuggestion || pending || submitting}
              placeholder="Generate a suggestion to edit the JSON payload."
            />

            {validation.errors.length > 0 && (
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="mb-1">Validation issues:</p>
                <ul className="list-disc pl-5">
                  {validation.errors.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'job' && hasSuggestion && bundleValidation.errors.length > 0 && (
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="mb-1">Bundle issues:</p>
                <ul className="list-disc pl-5">
                  {bundleValidation.errors.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'job' && hasSuggestion && !canCreateJob && (
              <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                Add a token with <code>job-bundles:write</code> scope to publish Codex-generated bundles automatically.
              </div>
            )}

            {hasSuggestion && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  Catalog snapshot shared with Codex
                </summary>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {formatSummary(metadataSummary)}
                </pre>
              </details>
            )}

            {hasSuggestion && (stdout || stderr) && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  Codex CLI logs
                </summary>
                {stdout && (
                  <div className="mt-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      stdout
                    </h4>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300">
                      {stdout}
                    </pre>
                  </div>
                )}
                {stderr && (
                  <div className="mt-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      stderr
                    </h4>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-rose-500 dark:text-rose-300">
                      {stderr}
                    </pre>
                  </div>
                )}
              </details>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {hasSuggestion ? (isEdited ? 'You have modified the generated spec.' : 'Spec matches Codex suggestion.') : 'Generate a suggestion to continue.'}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {mode === 'workflow' && (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200"
                    onClick={handleOpenInBuilder}
                    disabled={!hasSuggestion || pending || submitting}
                  >
                    Review in manual builder
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={mode === 'workflow' ? handleSubmitWorkflow : handleSubmitJob}
                  disabled={!canSubmit}
                >
                  {submitting ? 'Submitting…' : mode === 'workflow' ? 'Submit workflow' : 'Submit job'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
