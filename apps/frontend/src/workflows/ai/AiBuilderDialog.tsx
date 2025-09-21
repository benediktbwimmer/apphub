import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent
} from 'react';
import { workflowDefinitionCreateSchema, jobDefinitionCreateSchema } from '@apphub/workflow-schemas';
import type { ZodIssue } from 'zod';
import {
  fetchAiGeneration,
  startAiGeneration,
  type AiBuilderMode,
  type AiGenerationState,
  type AiSuggestionResponse
} from './api';
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

const GENERATION_STORAGE_KEY = 'apphub.aiBuilder.activeGeneration';
const POLL_INTERVAL_MS = 1_500;

const MODE_OPTIONS: { value: AiBuilderMode; label: string }[] = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'job', label: 'Job' },
  { value: 'job-with-bundle', label: 'Job + bundle' }
];

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
  const [mode, setMode] = useState<AiBuilderMode>('workflow');
  const [prompt, setPrompt] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataSummary, setMetadataSummary] = useState('');
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [summaryText, setSummaryText] = useState<string | null>(null);
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
  const [generation, setGeneration] = useState<AiGenerationState | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySuggestion = useCallback(
    (response: AiSuggestionResponse) => {
      const nextMode = response.mode;
      setMode(nextMode);
      const initialValue = response.suggestion
        ? JSON.stringify(response.suggestion, null, 2)
        : (response.raw ?? '').trim();
      setMetadataSummary(response.metadataSummary ?? '');
      setStdout(response.stdout ?? '');
      setStderr(response.stderr ?? '');
      setSummaryText(response.summary ?? null);
      setEditorValue(initialValue);
      setBaselineValue(initialValue);
      setHasSuggestion(Boolean(initialValue));
      setValidation(toValidationErrors(nextMode, initialValue));
      setBundleSuggestion((response.bundle as AiBundleSuggestion | null) ?? null);
      setBundleValidation(
        response.bundleValidation ?? {
          valid: true,
          errors: []
        }
      );
    },
    []
  );

  const persistGeneration = useCallback((id: string, modeValue: AiBuilderMode) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify({ id, mode: modeValue }));
  }, []);

  const clearPersistedGeneration = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.removeItem(GENERATION_STORAGE_KEY);
  }, []);

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
      setSummaryText(null);
      setEditorValue('');
      setBaselineValue('');
      setValidation({ valid: false, errors: [] });
      setHasSuggestion(false);
      setSubmitting(false);
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
      setGeneration(null);
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValidation(toValidationErrors(mode, editorValue));
  }, [mode, editorValue, open]);

  useEffect(() => {
    if (!open || generation) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem(GENERATION_STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as { id?: string; mode?: AiBuilderMode };
      if (!parsed.id) {
        clearPersistedGeneration();
        return;
      }
      setPending(true);
      fetchAiGeneration(authorizedFetch, parsed.id)
        .then((state) => {
          setGeneration(state);
          setMode(state.mode);
          setMetadataSummary(state.metadataSummary ?? '');
          setStdout(state.stdout ?? '');
          setStderr(state.stderr ?? '');
          setSummaryText(state.summary ?? null);

          if (state.status === 'succeeded' && state.result) {
            applySuggestion(state.result);
            setHasSuggestion(true);
            setPending(false);
            clearPersistedGeneration();
          } else if (state.status === 'failed') {
            setError(state.error ?? 'Codex generation failed');
            setPending(false);
            clearPersistedGeneration();
          } else {
            setHasSuggestion(false);
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Failed to resume AI generation';
          setError(message);
          setPending(false);
          clearPersistedGeneration();
        });
    } catch {
      clearPersistedGeneration();
    }
  }, [applySuggestion, authorizedFetch, clearPersistedGeneration, generation, open]);

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!prompt.trim()) {
        setError('Describe the workflow or job you would like to generate.');
        return;
      }
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setPending(true);
      setError(null);
      setHasSuggestion(false);
      setEditorValue('');
      setBaselineValue('');
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
      setSummaryText(null);
      const requestMode: AiBuilderMode = mode;
      try {
        const response = await startAiGeneration(authorizedFetch, {
          mode: requestMode,
          prompt: prompt.trim(),
          additionalNotes: additionalNotes.trim() || undefined
        });
        setGeneration(response);
        setMetadataSummary(response.metadataSummary ?? '');
        setStdout(response.stdout ?? '');
        setStderr(response.stderr ?? '');
        setSummaryText(response.summary ?? null);

        if (response.status === 'succeeded' && response.result) {
          applySuggestion(response.result);
          setHasSuggestion(true);
          setPending(false);
          clearPersistedGeneration();
        } else if (response.status === 'failed') {
          const failureMessage = response.error ?? 'Codex generation failed';
          setError(failureMessage);
          setPending(false);
          clearPersistedGeneration();
        } else {
          persistGeneration(response.generationId, requestMode);
        }
        console.info('ai-builder.usage', {
          event: 'generation-started',
          mode: requestMode,
          promptLength: prompt.trim().length,
          immediateResult: response.status !== 'running'
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start AI generation';
        setError(message);
        setPending(false);
        clearPersistedGeneration();
        console.error('ai-builder.error', { event: 'generate', message, mode: requestMode, error: err });
      }
    },
    [additionalNotes, applySuggestion, authorizedFetch, clearPersistedGeneration, mode, persistGeneration, prompt]
  );

  useEffect(() => {
    if (!generation || generation.status !== 'running') {
      if (generation) {
        setPending(false);
        clearPersistedGeneration();
      }
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchAiGeneration(authorizedFetch, generation.generationId);
        if (cancelled) {
          return;
        }
        setGeneration(next);
        setMetadataSummary(next.metadataSummary ?? '');
        setStdout(next.stdout ?? '');
        setStderr(next.stderr ?? '');
        setSummaryText(next.summary ?? null);

        if (next.status === 'running') {
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (next.status === 'succeeded' && next.result) {
          applySuggestion(next.result);
          setHasSuggestion(true);
          setPending(false);
          clearPersistedGeneration();
        } else if (next.status === 'failed') {
          setError(next.error ?? 'Codex generation failed');
          setPending(false);
          clearPersistedGeneration();
        } else {
          setPending(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to poll AI generation';
        setError(message);
        setPending(false);
        clearPersistedGeneration();
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [applySuggestion, authorizedFetch, clearPersistedGeneration, generation]);

  const handleModeChange = useCallback(
    (nextMode: AiBuilderMode) => {
      setMode(nextMode);
      setHasSuggestion(false);
      setEditorValue('');
      setBaselineValue('');
      setValidation({ valid: false, errors: [] });
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
      setGeneration(null);
      setStdout('');
      setStderr('');
      setSummaryText(null);
      clearPersistedGeneration();
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      console.info('ai-builder.usage', { event: 'mode-changed', mode: nextMode });
    },
    [clearPersistedGeneration]
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
    if (mode !== 'job-with-bundle') {
      setError('Job submission is only available when including a bundle.');
      return;
    }
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
    (mode === 'job-with-bundle'
      ? Boolean(bundleSuggestion) && bundleValidation.valid && canCreateJob
      : mode === 'job'
      ? false
      : true);

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
              {MODE_OPTIONS.map(({ value, label }) => {
                const isActive = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full px-4 py-1.5 transition-colors ${
                      isActive
                        ? 'bg-violet-600 text-white shadow'
                        : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                    }`}
                    onClick={() => handleModeChange(value)}
                  >
                    {label}
                  </button>
                );
              })}
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

              {generation && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-xs font-semibold shadow-sm transition-colors ${
                    generation.status === 'running'
                      ? 'border-violet-300/70 bg-violet-50/70 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200'
                      : generation.status === 'succeeded'
                      ? 'border-emerald-300/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                      : 'border-rose-300/70 bg-rose-50/70 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
                  }`}
                >
                  {generation.status === 'running' && 'Codex is generating a suggestion. You can close the dialog and return later to resume.'}
                  {generation.status === 'succeeded' && 'Latest Codex generation completed.'}
                  {generation.status === 'failed' && (generation.error ?? 'Codex generation failed.')}
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

            {mode === 'job' && hasSuggestion && (
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300">
                Job-only mode generates a definition without publishing a bundle. Use the manual job builder or export the JSON.
              </div>
            )}

            {mode === 'job-with-bundle' && hasSuggestion && bundleValidation.errors.length > 0 && (
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="mb-1">Bundle issues:</p>
                <ul className="list-disc pl-5">
                  {bundleValidation.errors.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'job-with-bundle' && hasSuggestion && !canCreateJob && (
              <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                Add a token with <code>job-bundles:write</code> scope to publish Codex-generated bundles automatically.
              </div>
            )}

            {(generation || hasSuggestion) && metadataSummary && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  Catalog snapshot shared with Codex
                </summary>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {formatSummary(metadataSummary)}
                </pre>
              </details>
            )}

            {summaryText && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  Codex summary notes
                </summary>
                <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {summaryText}
                </pre>
              </details>
            )}

            {(stdout || stderr) && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Codex CLI logs</h4>
                  {generation?.status === 'running' && (
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
                      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-violet-500" /> Running…
                    </span>
                  )}
                  {generation?.status === 'succeeded' && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Completed</span>
                  )}
                  {generation?.status === 'failed' && (
                    <span className="text-xs font-semibold text-rose-500 dark:text-rose-300">Failed</span>
                  )}
                </div>
                {stdout && (
                  <div className="mt-2">
                    <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      stdout
                    </h5>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300">
                      {stdout}
                    </pre>
                  </div>
                )}
                {stderr && (
                  <div className="mt-2">
                    <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      stderr
                    </h5>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-rose-500 dark:text-rose-300">
                      {stderr}
                    </pre>
                  </div>
                )}
              </div>
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
                  {submitting
                    ? 'Submitting…'
                    : mode === 'workflow'
                    ? 'Submit workflow'
                    : mode === 'job-with-bundle'
                    ? 'Submit job + bundle'
                    : 'Submit job'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
