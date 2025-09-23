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
  type AiBuilderProvider,
  type AiGenerationState,
  type AiSuggestionResponse,
  type AiWorkflowDependency,
  type AiWorkflowPlan
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
import { useAiBuilderSettings } from '../../ai/useAiBuilderSettings';
import {
  DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS,
  DEFAULT_AI_BUILDER_SYSTEM_PROMPT
} from '@apphub/ai-prompts';

const WORKFLOW_SCHEMA = workflowDefinitionCreateSchema;
const JOB_SCHEMA = jobDefinitionCreateSchema;

const DEFAULT_SYSTEM_PROMPT_TRIMMED = DEFAULT_AI_BUILDER_SYSTEM_PROMPT.trim();
const DEFAULT_RESPONSE_INSTRUCTIONS_TRIMMED = DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS.trim();

const GENERATION_STORAGE_KEY = 'apphub.aiBuilder.activeGeneration';
const POLL_INTERVAL_MS = 1_500;

type JobDraft = {
  id: string;
  slug: string;
  mode: Extract<AiBuilderMode, 'job' | 'job-with-bundle'>;
  prompt: string;
  promptDraft: string;
  summary?: string | null;
  rationale?: string | null;
  dependsOn: string[];
  value: string;
  validation: { valid: boolean; errors: string[] };
  bundle: AiBundleSuggestion | null;
  bundleErrors: string[];
  generating: boolean;
  generationError: string | null;
  created: boolean;
  creating: boolean;
  creationError: string | null;
};

type GenerationContext =
  | { kind: 'primary'; mode: AiBuilderMode }
  | { kind: 'dependency'; dependencyId: string; mode: Extract<AiBuilderMode, 'job' | 'job-with-bundle'> };

const MODE_OPTIONS: { value: AiBuilderMode; label: string }[] = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'workflow-with-jobs', label: 'Workflow + jobs' },
  { value: 'job', label: 'Job' },
  { value: 'job-with-bundle', label: 'Job + bundle' }
];

const PROVIDER_OPTIONS: { value: AiBuilderProvider; label: string; description: string }[] = [
  {
    value: 'codex',
    label: 'Codex CLI',
    description: 'Runs through the host Codex proxy. Provides streaming stdout/stderr.'
  },
  {
    value: 'openai',
    label: 'OpenAI GPT-5',
    description: 'Calls the OpenAI API with high reasoning effort to draft structured output.'
  },
  {
    value: 'openrouter',
    label: 'Grok 4 (OpenRouter)',
    description: 'Uses OpenRouter to access xAI\'s Grok 4 fast model. Requires an OpenRouter API key.'
  }
];

const PROVIDER_LABELS: Record<AiBuilderProvider, string> = {
  codex: 'Codex CLI',
  openai: 'OpenAI GPT-5',
  openrouter: 'Grok 4 (OpenRouter)'
};

function toValidationErrors(mode: AiBuilderMode, editorValue: string): { valid: boolean; errors: string[] } {
  if (!editorValue.trim()) {
    return { valid: false, errors: [] };
  }
  try {
    const parsed = JSON.parse(editorValue) as unknown;
    const schema = mode === 'workflow' || mode === 'workflow-with-jobs' ? WORKFLOW_SCHEMA : JOB_SCHEMA;
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
  const { settings: aiSettings, setPreferredProvider } = useAiBuilderSettings();
  const [provider, setProvider] = useState<AiBuilderProvider>(aiSettings.preferredProvider);
  const [mode, setMode] = useState<AiBuilderMode>('workflow');
  const [prompt, setPrompt] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_AI_BUILDER_SYSTEM_PROMPT);
  const [responseInstructions, setResponseInstructions] = useState(
    DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS
  );
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
  const [plan, setPlan] = useState<AiWorkflowPlan | null>(null);
  const [jobDrafts, setJobDrafts] = useState<JobDraft[]>([]);
  const [workflowNotes, setWorkflowNotes] = useState<string | null>(null);
  const [generation, setGeneration] = useState<AiGenerationState | null>(null);
  const [generationContext, setGenerationContext] = useState<GenerationContext | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAiApiKey = aiSettings.openAiApiKey.trim();
  const openAiMaxOutputTokens = aiSettings.openAiMaxOutputTokens;
  const openRouterApiKey = aiSettings.openRouterApiKey.trim();
  const openRouterReferer = aiSettings.openRouterReferer.trim();
  const openRouterTitle = aiSettings.openRouterTitle.trim();

  const providerDisplayName = useCallback((candidate: AiBuilderProvider) => PROVIDER_LABELS[candidate], []);

  const providerKeyMessage = useCallback(
    (candidate: AiBuilderProvider): string | null => {
      if (candidate === 'openai' && openAiApiKey.length === 0) {
        return 'Add an OpenAI API key in Settings → AI builder before generating with OpenAI.';
      }
      if (candidate === 'openrouter' && openRouterApiKey.length === 0) {
        return 'Add an OpenRouter API key in Settings → AI builder before generating with OpenRouter.';
      }
      return null;
    },
    [openAiApiKey, openRouterApiKey]
  );

  const providerKeyMissing = useCallback(
    (candidate: AiBuilderProvider) => providerKeyMessage(candidate) !== null,
    [providerKeyMessage]
  );

  const buildProviderOptionsPayload = useCallback(
    (selectedProvider: AiBuilderProvider) => {
      if (selectedProvider === 'openai') {
        return {
          openAiApiKey,
          openAiMaxOutputTokens
        };
      }
      if (selectedProvider === 'openrouter') {
        return {
          openRouterApiKey,
          openRouterReferer: openRouterReferer || undefined,
          openRouterTitle: openRouterTitle || undefined
        };
      }
      return undefined;
    },
    [openAiApiKey, openAiMaxOutputTokens, openRouterApiKey, openRouterReferer, openRouterTitle]
  );

  const buildPromptOverridesPayload = useCallback(() => {
    const overrides: { systemPrompt?: string; responseInstructions?: string } = {};
    const normalizedSystem = systemPrompt.trim();
    const normalizedInstructions = responseInstructions.trim();

    if (normalizedSystem.length > 0 && normalizedSystem !== DEFAULT_SYSTEM_PROMPT_TRIMMED) {
      overrides.systemPrompt = normalizedSystem;
    }

    if (
      normalizedInstructions.length > 0 &&
      normalizedInstructions !== DEFAULT_RESPONSE_INSTRUCTIONS_TRIMMED
    ) {
      overrides.responseInstructions = normalizedInstructions;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [responseInstructions, systemPrompt]);

  const handleResetPrompts = useCallback(() => {
    setSystemPrompt(DEFAULT_AI_BUILDER_SYSTEM_PROMPT);
    setResponseInstructions(DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS);
  }, []);

  const applyPrimarySuggestion = useCallback(
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

      if (nextMode === 'workflow-with-jobs') {
        const workflowPlan = response.plan ?? null;
        setPlan(workflowPlan);
        setWorkflowNotes(workflowPlan?.notes ?? response.notes ?? null);
        setBundleSuggestion(null);
        setBundleValidation({ valid: true, errors: [] });

        const planDependencies = workflowPlan?.dependencies ?? [];
        const drafts = planDependencies
          .filter((dependency): dependency is AiWorkflowDependency & { kind: 'job' | 'job-with-bundle' } =>
            dependency.kind === 'job' || dependency.kind === 'job-with-bundle'
          )
          .map((dependency) => ({
            id: dependency.jobSlug,
            slug: dependency.jobSlug,
            mode: dependency.kind,
            prompt: dependency.prompt ?? '',
            promptDraft: dependency.prompt ?? '',
            summary: dependency.summary ?? null,
            rationale: dependency.rationale ?? null,
            dependsOn: dependency.dependsOn ?? [],
            value: '',
            validation: { valid: false, errors: [] },
            bundle: null,
            bundleErrors: [],
            generating: false,
            generationError: null,
            created: false,
            creating: false,
            creationError: null
          }));
        setJobDrafts(drafts);
      } else {
        setPlan(null);
        setWorkflowNotes(response.notes ?? null);
        if (nextMode === 'job-with-bundle') {
          const bundle = (response.bundle as AiBundleSuggestion | null) ?? null;
          setBundleSuggestion(bundle);
          setBundleValidation(
            response.bundleValidation ?? {
              valid: Boolean(bundle),
              errors: []
            }
          );
        } else {
          setBundleSuggestion(null);
          setBundleValidation({ valid: true, errors: [] });
        }
        setJobDrafts([]);
      }
    },
    []
  );

  const applyDependencySuggestion = useCallback(
    (dependencyId: string, response: AiSuggestionResponse) => {
      const nextValue = response.suggestion
        ? JSON.stringify(response.suggestion, null, 2)
        : (response.raw ?? '').trim();
      const jobErrors = response.validation?.errors ?? [];
      setJobDrafts((current) =>
        current.map((draft) => {
          if (draft.id !== dependencyId) {
            return draft;
          }
          const bundleErrors =
            draft.mode === 'job-with-bundle'
              ? response.bundleValidation?.errors ?? []
              : [];
          return {
            ...draft,
            value: nextValue,
            validation: toValidationErrors(draft.mode, nextValue),
            bundle:
              draft.mode === 'job-with-bundle'
                ? ((response.bundle as AiBundleSuggestion | null) ?? null)
                : null,
            bundleErrors,
            generating: false,
            generationError:
              jobErrors.length > 0 || bundleErrors.length > 0
                ? [...jobErrors, ...bundleErrors].join('\n')
                : null,
            created: false,
            creating: false,
            creationError: null
          };
        })
      );
    },
    []
  );

  const applyGenerationResult = useCallback(
    (response: AiSuggestionResponse, context: GenerationContext | null) => {
      if (context && context.kind === 'dependency') {
        applyDependencySuggestion(context.dependencyId, response);
      } else {
        applyPrimarySuggestion(response);
      }
    },
    [applyDependencySuggestion, applyPrimarySuggestion]
  );

  const handleGenerationFailure = useCallback(
    (context: GenerationContext | null, message: string) => {
      setError(message);
      if (context && context.kind === 'dependency') {
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === context.dependencyId
              ? { ...draft, generating: false, generationError: message }
              : draft
          )
        );
      }
    },
    []
  );

  const handleGenerateDependency = useCallback(
    async (dependencyId: string) => {
      const target = jobDrafts.find((draft) => draft.id === dependencyId);
      if (!target) {
        return;
      }
      const promptText = target.promptDraft.trim();
      if (!promptText) {
        handleGenerationFailure(
          { kind: 'dependency', dependencyId: target.id, mode: target.mode },
          'Add or edit the prompt before generating this job.'
        );
        return;
      }
      const missingMessage = providerKeyMessage(provider);
      if (missingMessage) {
        setError(missingMessage);
        return;
      }
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setPending(true);
      setGenerationContext({ kind: 'dependency', dependencyId: target.id, mode: target.mode });
      setJobDrafts((current) =>
        current.map((draft) =>
          draft.id === dependencyId ? { ...draft, generating: true, generationError: null } : draft
        )
      );
      try {
        const providerOptionsPayload = buildProviderOptionsPayload(provider);
        const response = await startAiGeneration(authorizedFetch, {
          mode: target.mode,
          prompt: promptText,
          additionalNotes: additionalNotes.trim() || undefined,
          provider,
          providerOptions: providerOptionsPayload,
          promptOverrides: buildPromptOverridesPayload()
        });
        setGeneration(response);
        setProvider(response.provider);
        setMetadataSummary(response.metadataSummary ?? '');
        setStdout(response.stdout ?? '');
        setStderr(response.stderr ?? '');
        setSummaryText(response.summary ?? null);

        if (response.status === 'succeeded' && response.result) {
          applyGenerationResult(response.result, {
            kind: 'dependency',
            dependencyId: target.id,
            mode: target.mode
          });
          setPending(false);
          setGenerationContext(null);
        } else if (response.status === 'failed') {
          const failureProvider = providerDisplayName(response.provider);
          const failureMessage = response.error ?? `${failureProvider} generation failed`;
          handleGenerationFailure(
            { kind: 'dependency', dependencyId: target.id, mode: target.mode },
            failureMessage
          );
          setPending(false);
          setGenerationContext(null);
        }
        console.info('ai-builder.usage', {
          event: 'dependency-generation-started',
          dependencyId: target.id,
          mode: target.mode,
          provider,
          promptLength: promptText.length,
          immediateResult: response.status !== 'running'
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate job suggestion';
        handleGenerationFailure({ kind: 'dependency', dependencyId: target.id, mode: target.mode }, message);
        setPending(false);
        setGenerationContext(null);
        console.error('ai-builder.error', {
          event: 'dependency-generate',
          dependencyId: target.id,
          message,
          error: err
        });
      }
    },
    [
      additionalNotes,
      applyGenerationResult,
      authorizedFetch,
      buildPromptOverridesPayload,
      handleGenerationFailure,
      jobDrafts,
      buildProviderOptionsPayload,
      provider,
      providerDisplayName,
      providerKeyMessage
    ]
  );

  const persistGeneration = useCallback((id: string, modeValue: AiBuilderMode, providerValue: AiBuilderProvider) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      GENERATION_STORAGE_KEY,
      JSON.stringify({ id, mode: modeValue, provider: providerValue })
    );
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
      setSystemPrompt(DEFAULT_AI_BUILDER_SYSTEM_PROMPT);
      setResponseInstructions(DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS);
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
      setPlan(null);
      setJobDrafts([]);
      setWorkflowNotes(null);
      setGeneration(null);
      setGenerationContext(null);
      setProvider(aiSettings.preferredProvider);
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [aiSettings.preferredProvider, open]);

  useEffect(() => {
    setProvider(aiSettings.preferredProvider);
  }, [aiSettings.preferredProvider]);

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
      const parsed = JSON.parse(stored) as { id?: string; mode?: AiBuilderMode; provider?: AiBuilderProvider };
      if (!parsed.id) {
        clearPersistedGeneration();
        return;
      }
      if (parsed.provider) {
        setProvider(parsed.provider);
      }
      setPending(true);
      fetchAiGeneration(authorizedFetch, parsed.id)
        .then((state) => {
          setGeneration(state);
          setMode(state.mode);
          setProvider(state.provider);
          setGenerationContext(state.status === 'running' ? { kind: 'primary', mode: state.mode } : null);
          setMetadataSummary(state.metadataSummary ?? '');
          setStdout(state.stdout ?? '');
          setStderr(state.stderr ?? '');
          setSummaryText(state.summary ?? null);

          if (state.status === 'succeeded' && state.result) {
            applyGenerationResult(state.result, { kind: 'primary', mode: state.mode });
            setHasSuggestion(true);
            setPending(false);
            clearPersistedGeneration();
          } else if (state.status === 'failed') {
            const providerName = providerDisplayName(state.provider);
            setError(state.error ?? `${providerName} generation failed`);
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
  }, [applyGenerationResult, authorizedFetch, clearPersistedGeneration, generation, open, providerDisplayName]);

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!prompt.trim()) {
        setError('Describe the workflow or job you would like to generate.');
        return;
      }
      const missingMessage = providerKeyMessage(provider);
      if (missingMessage) {
        setError(missingMessage);
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
      setPlan(null);
      setJobDrafts([]);
      setWorkflowNotes(null);
      setSummaryText(null);
      const requestMode: AiBuilderMode = mode;
      setGenerationContext({ kind: 'primary', mode: requestMode });
      try {
        const providerOptionsPayload = buildProviderOptionsPayload(provider);
        const response = await startAiGeneration(authorizedFetch, {
          mode: requestMode,
          prompt: prompt.trim(),
          additionalNotes: additionalNotes.trim() || undefined,
          provider,
          providerOptions: providerOptionsPayload,
          promptOverrides: buildPromptOverridesPayload()
        });
        setGeneration(response);
        setProvider(response.provider);
        setMetadataSummary(response.metadataSummary ?? '');
        setStdout(response.stdout ?? '');
        setStderr(response.stderr ?? '');
        setSummaryText(response.summary ?? null);

        if (response.status === 'succeeded' && response.result) {
          applyGenerationResult(response.result, { kind: 'primary', mode: requestMode });
          setHasSuggestion(true);
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else if (response.status === 'failed') {
          const failureProvider = providerDisplayName(response.provider);
          const failureMessage = response.error ?? `${failureProvider} generation failed`;
          setError(failureMessage);
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else {
          persistGeneration(response.generationId, requestMode, provider);
        }
        console.info('ai-builder.usage', {
          event: 'generation-started',
          mode: requestMode,
          provider,
          promptLength: prompt.trim().length,
          immediateResult: response.status !== 'running'
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start AI generation';
        setError(message);
        setPending(false);
        clearPersistedGeneration();
        setGenerationContext(null);
        console.error('ai-builder.error', { event: 'generate', message, mode: requestMode, error: err });
      }
    },
    [
      additionalNotes,
      applyGenerationResult,
      authorizedFetch,
      buildPromptOverridesPayload,
      buildProviderOptionsPayload,
      clearPersistedGeneration,
      mode,
      providerDisplayName,
      providerKeyMessage,
      persistGeneration,
      prompt,
      provider
    ]
  );

  useEffect(() => {
    if (!generation || generation.status !== 'running') {
      if (generation) {
        setPending(false);
        clearPersistedGeneration();
        setGenerationContext(null);
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
        setProvider(next.provider);
        setMetadataSummary(next.metadataSummary ?? '');
        setStdout(next.stdout ?? '');
        setStderr(next.stderr ?? '');
        setSummaryText(next.summary ?? null);

        if (next.status === 'running') {
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (next.status === 'succeeded' && next.result) {
          const context = generationContext ?? { kind: 'primary', mode: next.mode };
          applyGenerationResult(next.result, context);
          if (!context || context.kind !== 'dependency') {
            setHasSuggestion(true);
          }
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else if (next.status === 'failed') {
          const providerName = providerDisplayName(next.provider);
          const failureMessage = next.error ?? `${providerName} generation failed`;
          handleGenerationFailure(generationContext, failureMessage);
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else {
          setPending(false);
          setGenerationContext(null);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to poll AI generation';
        handleGenerationFailure(generationContext, message);
        setPending(false);
        clearPersistedGeneration();
        setGenerationContext(null);
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
  }, [
    applyGenerationResult,
    authorizedFetch,
    clearPersistedGeneration,
    generation,
    generationContext,
    handleGenerationFailure,
    providerDisplayName
  ]);

  const handleModeChange = useCallback(
    (nextMode: AiBuilderMode) => {
      setMode(nextMode);
      setHasSuggestion(false);
      setEditorValue('');
      setBaselineValue('');
      setValidation({ valid: false, errors: [] });
      setBundleSuggestion(null);
      setBundleValidation({ valid: true, errors: [] });
      setPlan(null);
      setJobDrafts([]);
      setWorkflowNotes(null);
      setGeneration(null);
      setGenerationContext(null);
      setStdout('');
      setStderr('');
      setSummaryText(null);
      clearPersistedGeneration();
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      console.info('ai-builder.usage', { event: 'mode-changed', mode: nextMode, provider });
    },
    [clearPersistedGeneration, provider, setJobDrafts, setWorkflowNotes]
  );

  const handleProviderChange = useCallback(
    (nextProvider: AiBuilderProvider) => {
      if (nextProvider === provider) {
        return;
      }
      setProvider(nextProvider);
      setPreferredProvider(nextProvider);
      console.info('ai-builder.usage', { event: 'provider-changed', provider: nextProvider });
    },
    [provider, setPreferredProvider]
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

  const promptsCustomized = useMemo(() => {
    const normalizedSystem = systemPrompt.trim();
    const normalizedInstructions = responseInstructions.trim();
    return (
      normalizedSystem !== DEFAULT_SYSTEM_PROMPT_TRIMMED ||
      normalizedInstructions !== DEFAULT_RESPONSE_INSTRUCTIONS_TRIMMED
    );
  }, [responseInstructions, systemPrompt]);

  const parseEditorValue = useCallback((): WorkflowCreateInput | JobDefinitionCreateInput | null => {
    if (!editorValue.trim()) {
      return null;
    }
    try {
      const json = JSON.parse(editorValue) as unknown;
      const schema = mode === 'workflow' || mode === 'workflow-with-jobs' ? WORKFLOW_SCHEMA : JOB_SCHEMA;
      const result = schema.parse(json);
      return result as WorkflowCreateInput | JobDefinitionCreateInput;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setError(message);
      setValidation(toValidationErrors(mode, editorValue));
      return null;
    }
  }, [editorValue, mode]);

  const buildGenerationMetadata = useCallback(() => {
    if (!generation) {
      return undefined;
    }
    return {
      id: generation.generationId,
      prompt: prompt.trim() || undefined,
      additionalNotes: additionalNotes.trim() || undefined,
      metadataSummary:
        generation.metadataSummary ?? (metadataSummary && metadataSummary.trim().length > 0 ? metadataSummary : undefined),
      rawOutput: generation.result?.raw ?? undefined,
      stdout: generation.result?.stdout ?? undefined,
      stderr: generation.result?.stderr ?? undefined,
      summary: generation.result?.summary ?? undefined,
      provider: generation.provider
    };
  }, [additionalNotes, generation, metadataSummary, prompt]);

  const handleSubmitWorkflow = useCallback(async () => {
    if (mode === 'workflow-with-jobs') {
      const bundleDrafts = jobDrafts.filter((draft) => draft.mode === 'job-with-bundle');
      if (bundleDrafts.some((draft) => draft.creating)) {
        setError('Wait for job creation to finish before submitting the workflow.');
        return;
      }
      if (bundleDrafts.some((draft) => draft.bundleErrors.length > 0 || !draft.validation.valid)) {
        setError('Resolve job validation issues before submitting the workflow.');
        return;
      }
      if (bundleDrafts.some((draft) => !draft.created)) {
        setError('Create the generated jobs before submitting the workflow.');
        return;
      }
    }
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
        validationErrors: validation.errors.length,
        provider: generation?.provider ?? provider
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
    provider,
    validation.errors.length,
    onWorkflowSubmitted,
    pushToast,
    refreshResources,
    onClose,
    jobDrafts,
    generation
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

  const handleJobDraftChange = useCallback((draftId: string, value: string) => {
    setJobDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              value,
              validation: toValidationErrors(draft.mode, value),
              generationError: null,
              creationError: null
            }
          : draft
      )
    );
  }, []);

  const handleJobPromptChange = useCallback((draftId: string, value: string) => {
    setJobDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, promptDraft: value } : draft))
    );
  }, []);

  const handleCreateDraftJob = useCallback(
    async (draftId: string) => {
      const target = jobDrafts.find((draft) => draft.id === draftId);
      if (!target || target.creating || target.created) {
        return;
      }
      if (!canCreateJob) {
        const scopeMessage = 'Your token must include the job-bundles:write scope to create AI-generated jobs.';
        setError(scopeMessage);
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId ? { ...draft, creationError: scopeMessage } : draft
          )
        );
        return;
      }
      if (target.mode !== 'job-with-bundle' || !target.bundle) {
        setError('This job dependency does not include a bundle. Create it manually via the job builder.');
        return;
      }
      if (target.bundleErrors.length > 0) {
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId
              ? {
                  ...draft,
                  creationError: 'Fix the bundle issues before creating this job.'
                }
              : draft
          )
        );
        return;
      }
      const validationResult = toValidationErrors(target.mode, target.value);
      if (!validationResult.valid) {
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId
              ? {
                  ...draft,
                  validation: validationResult,
                  creationError: 'Resolve validation issues before creating this job.'
                }
              : draft
          )
        );
        return;
      }

      let parsedJob: JobDefinitionCreateInput;
      try {
        parsedJob = JOB_SCHEMA.parse(JSON.parse(target.value));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid job definition';
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId
              ? {
                  ...draft,
                  validation: toValidationErrors(target.mode, target.value),
                  creationError: `Invalid job definition: ${message}`
                }
              : draft
          )
        );
        return;
      }

      setJobDrafts((current) =>
        current.map((draft) =>
          draft.id === draftId
            ? { ...draft, creating: true, creationError: null }
            : draft
        )
      );

      try {
        const jobPayload: JobDefinitionCreateInput = {
          ...parsedJob,
          entryPoint: `bundle:${target.bundle.slug}@${target.bundle.version}`
        };
        const generationPayload = buildGenerationMetadata();
        const response = await createJobWithBundle(authorizedFetch, {
          job: jobPayload,
          bundle: target.bundle,
          generation: generationPayload
        });
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId
              ? {
                  ...draft,
                  creating: false,
                  created: true,
                  validation: { valid: true, errors: [] },
                  creationError: null
                }
              : draft
          )
        );
        console.info('ai-builder.usage', {
          event: 'job-submitted',
          edited: false,
          mode,
          jobSlug: response.job.slug,
          viaWorkflowBuilder: true
        });
        pushToast({
          tone: 'success',
          title: 'Job created',
          description: `${response.job.name} registered successfully.`
        });
        refreshResources();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create job';
        setJobDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId
              ? { ...draft, creating: false, creationError: message }
              : draft
          )
        );
        console.error('ai-builder.error', {
          event: 'job-submit',
          message,
          mode,
          error: err,
          jobSlug: target.slug
        });
      }
    },
    [
      authorizedFetch,
      buildGenerationMetadata,
      canCreateJob,
      jobDrafts,
      mode,
      pushToast,
      refreshResources
    ]
  );

  const handleSubmitJob = useCallback(async () => {
    if (mode !== 'job-with-bundle') {
      setError('Job submission is only available when including a bundle.');
      return;
    }
    if (!canCreateJob) {
      setError('Your token must include the job-bundles:write scope to create AI-generated jobs.');
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
      const generationPayload = buildGenerationMetadata();

      const created: JobDefinitionSummary = (
        await createJobWithBundle(authorizedFetch, {
          job: jobPayload,
          bundle: bundleSuggestion,
          generation: generationPayload
        })
      ).job;
      console.info('ai-builder.usage', {
        event: 'job-submitted',
        edited: isEdited,
        mode,
        jobSlug: created.slug,
        provider: generation?.provider ?? provider
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
    canCreateJob,
    buildGenerationMetadata,
    provider,
    generation
  ]);

  const handleDismiss = useCallback(() => {
    if (hasSuggestion) {
      console.info('ai-builder.usage', {
        event: 'dismissed',
        mode,
        edited: isEdited,
        provider: generation?.provider ?? provider
      });
    }
    onClose();
  }, [generation, hasSuggestion, isEdited, mode, onClose, provider]);

  const activeProvider = generation?.provider ?? provider;
  const providerSelectionLabel = providerDisplayName(provider);
  const activeProviderLabel = providerDisplayName(activeProvider);
  const providerHasLogs = activeProvider === 'codex';
  const providerRequiresKey = providerKeyMissing(provider);
  const providerKeyHint = providerRequiresKey ? providerKeyMessage(provider) : null;
  const providerLogTitle =
    activeProvider === 'openai'
      ? 'OpenAI response log'
      : activeProvider === 'openrouter'
      ? 'OpenRouter response log'
      : 'Codex CLI logs';

  if (!open) {
    return null;
  }

  const bundleDrafts = jobDrafts.filter((draft) => draft.mode === 'job-with-bundle');
  const allJobDraftsReady =
    bundleDrafts.length === 0 ||
    bundleDrafts.every(
      (draft) => draft.created && draft.bundleErrors.length === 0 && draft.validation.valid && !draft.creating
    );

  const canSubmit =
    validation.valid &&
    !pending &&
    !submitting &&
    editorValue.trim().length > 0 &&
    (mode === 'job-with-bundle'
      ? Boolean(bundleSuggestion) && bundleValidation.valid && canCreateJob
      : mode === 'job'
      ? false
      : mode === 'workflow-with-jobs'
      ? allJobDraftsReady
      : true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 p-6 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI Workflow Builder</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Describe the automation you need and let {providerSelectionLabel} draft a job or workflow definition.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="inline-flex rounded-full border border-slate-200/80 bg-white p-1 text-xs font-semibold shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
                {PROVIDER_OPTIONS.map(({ value, label }) => {
                  const isActive = provider === value;
                  const requireKey = providerKeyMissing(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-full px-4 py-1.5 transition-colors ${
                        isActive
                          ? 'bg-violet-600 text-white shadow'
                          : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                      } ${requireKey ? 'opacity-70' : ''}`}
                      onClick={() => handleProviderChange(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
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
            </div>
            {providerKeyHint ? (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                {providerKeyHint}
              </span>
            ) : null}
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

              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm transition-colors dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-100">
                  Advanced prompt configuration
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    System prompt
                    <textarea
                      className="h-40 rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      spellCheck={false}
                      disabled={pending || submitting}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Response instructions
                    <textarea
                      className="h-20 rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                      value={responseInstructions}
                      onChange={(event) => setResponseInstructions(event.target.value)}
                      spellCheck={false}
                      disabled={pending || submitting}
                    />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Adjust prompts before generating to steer the AI builder.</span>
                    {promptsCustomized && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-3 py-1 font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:text-slate-100"
                        onClick={handleResetPrompts}
                        disabled={pending || submitting}
                      >
                        Reset prompts
                      </button>
                    )}
                  </div>
                </div>
              </details>

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
                  {generation.status === 'running' &&
                    `${activeProviderLabel} is generating a suggestion. You can close the dialog and return later to resume.`}
                  {generation.status === 'succeeded' && `Latest ${activeProviderLabel} generation completed.`}
                  {generation.status === 'failed' && (generation.error ?? `${activeProviderLabel} generation failed.`)}
                </div>
              )}

              <div className="mt-auto flex items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={pending || submitting || providerRequiresKey}
                >
                  {pending ? 'Generating…' : 'Generate suggestion'}
                </button>
                {hasSuggestion && (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200"
                    onClick={() => handleGenerate()}
                    disabled={pending || submitting || providerRequiresKey}
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

            {mode === 'workflow-with-jobs' && plan && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Dependency plan</h4>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
                    {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
                  </span>
                </div>
                {plan.notes && (
                  <p className="mt-2 rounded-xl border border-slate-200/60 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-300">
                    {plan.notes}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {plan.dependencies.map((dependency) => {
                    const draft = jobDrafts.find((item) => item.slug === dependency.jobSlug);
                    const isBundle = dependency.kind === 'job-with-bundle';
                    const badge =
                      dependency.kind === 'existing-job'
                        ? { text: 'Existing job', className: 'text-emerald-600 dark:text-emerald-300' }
                        : draft?.mode === 'job-with-bundle' && draft.created
                        ? { text: 'Bundle published', className: 'text-emerald-600 dark:text-emerald-300' }
                        : draft?.value.trim()
                        ? { text: 'Draft ready', className: 'text-violet-600 dark:text-violet-300' }
                        : { text: 'Pending', className: 'text-slate-500 dark:text-slate-400' };
                    const displayName =
                      'name' in dependency && dependency.name
                        ? `${dependency.jobSlug} · ${dependency.name}`
                        : dependency.jobSlug;
                    return (
                      <div
                        key={`${dependency.kind}-${dependency.jobSlug}`}
                        className="rounded-xl border border-slate-200/60 bg-white/80 p-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{displayName}</p>
                            {'summary' in dependency && dependency.summary && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{dependency.summary}</p>
                            )}
                          </div>
                          <span className={`text-xs font-semibold ${badge.className}`}>{badge.text}</span>
                        </div>
                        {'rationale' in dependency && dependency.rationale && (
                          <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {dependency.rationale}
                          </p>
                        )}
                        {'dependsOn' in dependency &&
                          dependency.dependsOn &&
                          dependency.dependsOn.length > 0 && (
                            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                              Depends on: {dependency.dependsOn.join(', ')}
                            </p>
                          )}
                        {isBundle && 'bundleOutline' in dependency && dependency.bundleOutline && (
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            Target entry point{' '}
                            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {dependency.bundleOutline.entryPoint}
                            </code>
                            {dependency.bundleOutline.files && dependency.bundleOutline.files.length > 0 && (
                              <>
                                {' '}
                                · Expected files{' '}
                                {dependency.bundleOutline.files.map((file) => file.path).join(', ')}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'workflow-with-jobs' && jobDrafts.length > 0 && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Generate required jobs</h4>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle' && draft.created).length}/
                    {jobDrafts.filter((draft) => draft.mode === 'job-with-bundle').length} bundles published
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  Iterate on each prompt, generate the job specification, and publish bundle-backed jobs before submitting the workflow.
                </p>
                {!canCreateJob && (
                  <div className="mt-3 rounded-xl border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                    Add a token with <code>job-bundles:write</code> scope to publish AI-generated jobs automatically.
                  </div>
                )}
                <div className="mt-3 space-y-3">
                  {jobDrafts.map((draft) => {
                    const dependency = plan?.dependencies.find(
                      (entry) =>
                        (entry.kind === 'job' || entry.kind === 'job-with-bundle') && entry.jobSlug === draft.slug
                    );
                    const isBundle = draft.mode === 'job-with-bundle';
                    const hasResult = draft.value.trim().length > 0;
                    const statusClass = draft.generating
                      ? 'text-violet-600 dark:text-violet-300'
                      : isBundle && draft.created
                      ? 'text-emerald-600 dark:text-emerald-300'
                      : hasResult
                      ? 'text-slate-600 dark:text-slate-300'
                      : 'text-slate-500 dark:text-slate-400';
                    const statusText = draft.generating
                      ? 'Generating…'
                      : isBundle && draft.created
                      ? 'Bundle published'
                      : hasResult
                      ? 'Draft ready'
                      : 'Pending';
                    const canGenerate =
                      !draft.generating &&
                      !pending &&
                      !submitting &&
                      draft.promptDraft.trim().length > 0 &&
                      !providerRequiresKey;
                    const canCreate =
                      isBundle &&
                      !!draft.bundle &&
                      draft.bundleErrors.length === 0 &&
                      draft.validation.valid &&
                      !draft.generating &&
                      !draft.creating &&
                      !draft.created &&
                      !pending &&
                      !submitting &&
                      canCreateJob;
                    return (
                      <div
                        key={draft.id}
                        className="rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/80"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                              {dependency && 'name' in dependency && dependency.name
                                ? `${dependency.name} (${draft.slug})`
                                : draft.slug}
                            </h5>
                            {dependency && 'summary' in dependency && dependency.summary && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{dependency.summary}</p>
                            )}
                          </div>
                          <span className={`text-xs font-semibold ${statusClass}`}>{statusText}</span>
                        </div>

                        {dependency && 'rationale' in dependency && dependency.rationale && (
                          <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {dependency.rationale}
                          </p>
                        )}

                        {dependency &&
                          'dependsOn' in dependency &&
                          dependency.dependsOn &&
                          dependency.dependsOn.length > 0 && (
                            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                              Depends on: {dependency.dependsOn.join(', ')}
                            </p>
                          )}

                        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Prompt
                        </label>
                        <textarea
                          className="mt-1 h-24 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 text-[11px] text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                          value={draft.promptDraft}
                          onChange={(event) => handleJobPromptChange(draft.id, event.target.value)}
                          spellCheck={false}
                          disabled={draft.generating || pending || submitting}
                        />

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleGenerateDependency(draft.id)}
                            disabled={!canGenerate}
                          >
                            {draft.generating ? 'Generating…' : 'Generate job'}
                          </button>
                          {draft.promptDraft.trim() !== draft.prompt.trim() && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:text-slate-100"
                              onClick={() => handleJobPromptChange(draft.id, draft.prompt)}
                              disabled={draft.generating || pending || submitting}
                            >
                              Reset prompt
                            </button>
                          )}
                        </div>

                        {draft.generationError && (
                          <div className="mt-2 rounded-lg border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                            {draft.generationError}
                          </div>
                        )}

                        {hasResult && (
                          <>
                            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Job definition
                            </label>
                            <textarea
                              className="mt-1 h-40 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                              value={draft.value}
                              onChange={(event) => handleJobDraftChange(draft.id, event.target.value)}
                              spellCheck={false}
                              disabled={draft.creating || draft.created || pending || submitting}
                            />
                          </>
                        )}

                        {draft.validation.errors.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                            <p className="mb-1">Validation issues:</p>
                            <ul className="list-disc pl-5">
                              {draft.validation.errors.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {isBundle && draft.bundle && (
                          <div className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 text-[11px] text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-300">
                            Bundle{' '}
                            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {draft.bundle.slug}@{draft.bundle.version}
                            </code>
                            , entry{' '}
                            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {draft.bundle.entryPoint}
                            </code>{' '}
                            · {draft.bundle.files.length} file{draft.bundle.files.length === 1 ? '' : 's'}
                          </div>
                        )}

                        {draft.bundleErrors.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                            <p className="mb-1">Bundle issues:</p>
                            <ul className="list-disc pl-5">
                              {draft.bundleErrors.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {draft.creationError && (
                          <div className="mt-2 rounded-lg border border-rose-300/70 bg-rose-50/70 p-3 text-[11px] font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                            {draft.creationError}
                          </div>
                        )}

                        {isBundle && (
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => handleCreateDraftJob(draft.id)}
                              disabled={!canCreate}
                            >
                              {draft.creating ? 'Creating…' : draft.created ? 'Job created' : 'Create job'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                Add a token with <code>job-bundles:write</code> scope to publish AI-generated bundles automatically.
              </div>
            )}

            {(generation || hasSuggestion) && metadataSummary && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  Catalog snapshot shared with {activeProviderLabel}
                </summary>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {formatSummary(metadataSummary)}
                </pre>
              </details>
            )}

            {summaryText && (
              <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-100">
                  {activeProviderLabel} summary notes
                </summary>
                <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {summaryText}
                </pre>
              </details>
            )}

            {workflowNotes && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Operator follow-up notes</h4>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {workflowNotes}
                </p>
              </div>
            )}

            {providerHasLogs && (stdout || stderr) && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">{providerLogTitle}</h4>
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
                {hasSuggestion
                  ? isEdited
                    ? 'You have modified the generated spec.'
                    : `Spec matches the ${activeProviderLabel} suggestion.`
                  : 'Generate a suggestion to continue.'}
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
                  onClick={mode === 'workflow' || mode === 'workflow-with-jobs' ? handleSubmitWorkflow : handleSubmitJob}
                  disabled={!canSubmit}
                >
                  {submitting
                    ? 'Submitting…'
                    : mode === 'workflow' || mode === 'workflow-with-jobs'
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
