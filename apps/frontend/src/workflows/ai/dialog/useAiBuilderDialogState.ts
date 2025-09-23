import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from 'react';
import { workflowDefinitionCreateSchema, jobDefinitionCreateSchema } from '@apphub/workflow-schemas';
import type { ZodIssue } from 'zod';
import {
  fetchAiGeneration,
  startAiGeneration,
  fetchAiContextPreview,
  createJobWithBundle,
  type AiBuilderMode,
  type AiBuilderProvider,
  type AiGenerationState,
  type AiSuggestionResponse,
  type AiWorkflowPlan,
  type AiWorkflowDependency,
  type AiContextPreview,
  type AiBundleSuggestion
} from '../api';
import {
  createWorkflowDefinition,
  type WorkflowCreateInput,
  type JobDefinitionCreateInput,
  type JobDefinitionSummary
} from '../../api';
import { useWorkflowResources } from '../../WorkflowResourcesContext';
import { useAiBuilderSettings } from '../../../ai/useAiBuilderSettings';
import {
  DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS,
  DEFAULT_AI_BUILDER_SYSTEM_PROMPT
} from '@apphub/ai-prompts';
import { PROVIDER_LABELS } from './constants';
import type {
  AiBuilderDialogProps,
  AiBuilderDialogState,
  AiBuilderDialogHandlers,
  GenerationContext,
  JobDraft
} from './types';

const WORKFLOW_SCHEMA = workflowDefinitionCreateSchema;
const JOB_SCHEMA = jobDefinitionCreateSchema;

const DEFAULT_SYSTEM_PROMPT_TRIMMED = DEFAULT_AI_BUILDER_SYSTEM_PROMPT.trim();
const DEFAULT_RESPONSE_INSTRUCTIONS_TRIMMED = DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS.trim();

const GENERATION_STORAGE_KEY = 'apphub.aiBuilder.activeGeneration';
const POLL_INTERVAL_MS = 1_500;

type ValidationResult = { valid: boolean; errors: string[] };

type ProviderOptionsPayload =
  | {
      openAiApiKey: string;
      openAiMaxOutputTokens: number;
    }
  | {
      openRouterApiKey: string;
      openRouterReferer?: string;
      openRouterTitle?: string;
    }
  | undefined;

function toValidationErrors(mode: AiBuilderMode, editorValue: string): ValidationResult {
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

function usePersistedGeneration() {
  const read = useCallback((): { id: string; mode: AiBuilderMode; provider: AiBuilderProvider } | null => {
    try {
      const raw = window.localStorage.getItem(GENERATION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { id: string; mode: AiBuilderMode; provider: AiBuilderProvider };
      if (parsed && parsed.id && parsed.mode) {
        return parsed;
      }
    } catch (err) {
      console.warn('ai-builder.persistence-error', err);
    }
    return null;
  }, []);

  const write = useCallback((payload: { id: string; mode: AiBuilderMode; provider: AiBuilderProvider }) => {
    try {
      window.localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('ai-builder.persistence-error', err);
    }
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(GENERATION_STORAGE_KEY);
    } catch (err) {
      console.warn('ai-builder.persistence-error', err);
    }
  }, []);

  return { read, write, clear };
}

function useProviderHelpers(
  openAiApiKey: string,
  openRouterApiKey: string
): {
  displayName: (provider: AiBuilderProvider) => string;
  keyMessage: (candidate: AiBuilderProvider) => string | null;
  keyMissing: (candidate: AiBuilderProvider) => boolean;
} {
  const displayName = useCallback((candidate: AiBuilderProvider) => PROVIDER_LABELS[candidate], []);

  const keyMessage = useCallback(
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

  const keyMissing = useCallback(
    (candidate: AiBuilderProvider) => keyMessage(candidate) !== null,
    [keyMessage]
  );

  return { displayName, keyMessage, keyMissing };
}

function buildProviderOptionsPayload(
  provider: AiBuilderProvider,
  options: {
    openAiApiKey: string;
    openAiMaxOutputTokens: number;
    openRouterApiKey: string;
    openRouterReferer: string;
    openRouterTitle: string;
  }
): ProviderOptionsPayload {
  if (provider === 'openai') {
    return {
      openAiApiKey: options.openAiApiKey,
      openAiMaxOutputTokens: options.openAiMaxOutputTokens
    };
  }

  if (provider === 'openrouter') {
    return {
      openRouterApiKey: options.openRouterApiKey,
      openRouterReferer: options.openRouterReferer || undefined,
      openRouterTitle: options.openRouterTitle || undefined
    };
  }

  return undefined;
}

export function useAiBuilderDialogState({
  authorizedFetch,
  onClose,
  onWorkflowPrefill,
  onWorkflowSubmitted,
  open,
  pushToast,
  canCreateJob
}: AiBuilderDialogProps): {
  state: AiBuilderDialogState;
  handlers: AiBuilderDialogHandlers;
  helpers: {
    providerKeyMissing: (provider: AiBuilderProvider) => boolean;
    providerDisplayName: (provider: AiBuilderProvider) => string;
  };
} {
  const { refresh: refreshResources } = useWorkflowResources();
  const { settings: aiSettings, setPreferredProvider } = useAiBuilderSettings();
  const [provider, setProvider] = useState<AiBuilderProvider>(aiSettings.preferredProvider);
  const [mode, setMode] = useState<AiBuilderMode>('workflow');
  const [prompt, setPrompt] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_AI_BUILDER_SYSTEM_PROMPT);
  const [responseInstructions, setResponseInstructions] = useState(DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataSummary, setMetadataSummary] = useState('');
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [validation, setValidation] = useState<ValidationResult>({ valid: false, errors: [] });
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [contextPreview, setContextPreview] = useState<AiContextPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [baselineValue, setBaselineValue] = useState('');
  const [bundleSuggestion, setBundleSuggestion] = useState<AiBundleSuggestion | null>(null);
  const [bundleValidation, setBundleValidation] = useState<ValidationResult>({ valid: true, errors: [] });
  const [plan, setPlan] = useState<AiWorkflowPlan | null>(null);
  const [jobDrafts, setJobDrafts] = useState<JobDraft[]>([]);
  const [workflowNotes, setWorkflowNotes] = useState<string | null>(null);
  const [generation, setGeneration] = useState<AiGenerationState | null>(null);
  const [generationContext, setGenerationContext] = useState<GenerationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextRequestIdRef = useRef(0);

  const {
    openAiApiKey,
    openAiMaxOutputTokens,
    openRouterApiKey,
    openRouterReferer,
    openRouterTitle
  } = useMemo(
    () => ({
      openAiApiKey: aiSettings.openAiApiKey.trim(),
      openAiMaxOutputTokens: aiSettings.openAiMaxOutputTokens,
      openRouterApiKey: aiSettings.openRouterApiKey.trim(),
      openRouterReferer: aiSettings.openRouterReferer.trim(),
      openRouterTitle: aiSettings.openRouterTitle.trim()
    }),
    [aiSettings]
  );

  const { read: readPersisted, write: writePersisted, clear: clearPersistedGeneration } = usePersistedGeneration();
  const { displayName: providerDisplayName, keyMessage: providerKeyMessage, keyMissing: providerKeyMissing } =
    useProviderHelpers(openAiApiKey, openRouterApiKey);

  const buildPromptOverridesPayload = useCallback(() => {
    const overrides: { systemPrompt?: string; responseInstructions?: string } = {};
    const normalizedSystem = systemPrompt.trim();
    const normalizedInstructions = responseInstructions.trim();

    if (normalizedSystem.length > 0 && normalizedSystem !== DEFAULT_SYSTEM_PROMPT_TRIMMED) {
      overrides.systemPrompt = normalizedSystem;
    }

    if (normalizedInstructions.length > 0 && normalizedInstructions !== DEFAULT_RESPONSE_INSTRUCTIONS_TRIMMED) {
      overrides.responseInstructions = normalizedInstructions;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [responseInstructions, systemPrompt]);

  const providerRequiresKey = providerKeyMissing(provider);
  const providerKeyHint = providerRequiresKey ? providerKeyMessage(provider) : null;

  const refreshContextPreview = useCallback(
    async (nextProvider: AiBuilderProvider, nextMode: AiBuilderMode) => {
      const requestId = ++contextRequestIdRef.current;
      setContextLoading(true);
      setContextError(null);
      try {
        const response = await fetchAiContextPreview(authorizedFetch, {
          provider: nextProvider,
          mode: nextMode
        });
        if (contextRequestIdRef.current !== requestId) {
          return;
        }
        setContextLoading(false);
        setContextPreview(response.contextPreview ?? null);
        setMetadataSummary(response.metadataSummary ?? '');
      } catch (err) {
        if (contextRequestIdRef.current !== requestId) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load context preview';
        setContextLoading(false);
        setContextError(message);
        setContextPreview(null);
      }
    },
    [authorizedFetch]
  );

  const applyPrimarySuggestion = useCallback(
    (response: AiSuggestionResponse) => {
      const nextMode = response.mode;
      setMode(nextMode);

      if (response.contextPreview) {
        setContextPreview(response.contextPreview);
      }

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
        setJobDrafts(drafts as JobDraft[]);
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
      if (response.contextPreview) {
        setContextPreview(response.contextPreview);
      }
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

  const providerOptionsPayload = useMemo(
    () => ({
      openAiApiKey,
      openAiMaxOutputTokens,
      openRouterApiKey,
      openRouterReferer,
      openRouterTitle
    }),
    [openAiApiKey, openAiMaxOutputTokens, openRouterApiKey, openRouterReferer, openRouterTitle]
  );

  const startGeneration = useCallback(
    async (
      requestMode: AiBuilderMode,
      requestPrompt: string,
      overrides?: GenerationContext
    ): Promise<AiGenerationState | null> => {
      const providerOptions = buildProviderOptionsPayload(provider, providerOptionsPayload);
      const response = await startAiGeneration(authorizedFetch, {
        mode: requestMode,
        prompt: requestPrompt,
        additionalNotes: additionalNotes.trim() || undefined,
        provider,
        providerOptions,
        promptOverrides: buildPromptOverridesPayload()
      });

      setGeneration(response);
      setProvider(response.provider);
      setMetadataSummary(response.metadataSummary ?? '');
      setStdout(response.stdout ?? '');
      setStderr(response.stderr ?? '');
      setSummaryText(response.summary ?? null);
      setContextPreview(response.contextPreview ?? response.result?.contextPreview ?? null);

      if (response.status === 'succeeded' && response.result) {
        applyGenerationResult(response.result, overrides ?? { kind: 'primary', mode: requestMode });
        setPending(false);
        setGenerationContext(null);
        clearPersistedGeneration();
        if (!overrides || overrides.kind !== 'dependency') {
          setHasSuggestion(true);
        }
      } else if (response.status === 'failed') {
        const failureProvider = providerDisplayName(response.provider);
        const failureMessage = response.error ?? `${failureProvider} generation failed`;
        handleGenerationFailure(overrides ?? { kind: 'primary', mode: requestMode }, failureMessage);
        setPending(false);
        setGenerationContext(null);
        clearPersistedGeneration();
      } else {
        writePersisted({ id: response.generationId, mode: requestMode, provider });
      }

      return response;
    },
    [
      additionalNotes,
      applyGenerationResult,
      authorizedFetch,
      buildPromptOverridesPayload,
      clearPersistedGeneration,
      handleGenerationFailure,
      provider,
      providerDisplayName,
      providerOptionsPayload,
      writePersisted
    ]
  );

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
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
        const response = await startGeneration(requestMode, trimmedPrompt, { kind: 'primary', mode: requestMode });
        console.info('ai-builder.usage', {
          event: 'generation-started',
          mode: requestMode,
          provider,
          promptLength: trimmedPrompt.length,
          immediateResult: response?.status !== 'running'
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start AI generation';
        setError(message);
        setPending(false);
        clearPersistedGeneration();
        setGenerationContext(null);
        setContextPreview(null);
        console.error('ai-builder.error', { event: 'generate', message, mode: requestMode, error: err });
      }
    },
    [
      mode,
      prompt,
      provider,
      providerKeyMessage,
      startGeneration,
      clearPersistedGeneration
    ]
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
        const response = await startGeneration(target.mode, promptText, {
          kind: 'dependency',
          dependencyId: target.id,
          mode: target.mode
        });
        console.info('ai-builder.usage', {
          event: 'dependency-generation-started',
          dependencyId: target.id,
          mode: target.mode,
          provider,
          promptLength: promptText.length,
          immediateResult: response?.status !== 'running'
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate job suggestion';
        handleGenerationFailure({ kind: 'dependency', dependencyId: target.id, mode: target.mode }, message);
        setPending(false);
        setGenerationContext(null);
        setContextPreview(null);
        console.error('ai-builder.error', {
          event: 'dependency-generate',
          dependencyId: target.id,
          message,
          error: err
        });
      }
    },
    [handleGenerationFailure, jobDrafts, provider, providerKeyMessage, startGeneration]
  );

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
      setContextPreview(null);
      setContextError(null);
      setStdout('');
      setStderr('');
      setSummaryText(null);
      clearPersistedGeneration();
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (open) {
        void refreshContextPreview(provider, nextMode);
      }
      console.info('ai-builder.usage', { event: 'mode-changed', mode: nextMode, provider });
    },
    [
      clearPersistedGeneration,
      open,
      provider,
      refreshContextPreview
    ]
  );

  const handleProviderChange = useCallback(
    (nextProvider: AiBuilderProvider) => {
      if (nextProvider === provider) {
        return;
      }
      setProvider(nextProvider);
      setPreferredProvider(nextProvider);
      setContextPreview(null);
      setContextError(null);
      if (open) {
        void refreshContextPreview(nextProvider, mode);
      }
      console.info('ai-builder.usage', { event: 'provider-changed', provider: nextProvider });
    },
    [mode, open, provider, refreshContextPreview, setPreferredProvider]
  );

  const handleEditorChange = useCallback((value: string) => {
    setEditorValue(value);
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
  }, []);

  const handleAdditionalNotesChange = useCallback((value: string) => {
    setAdditionalNotes(value);
  }, []);

  const handleSystemPromptChange = useCallback((value: string) => {
    setSystemPrompt(value);
  }, []);

  const handleResponseInstructionsChange = useCallback((value: string) => {
    setResponseInstructions(value);
  }, []);

  const handleResetPrompts = useCallback(() => {
    setSystemPrompt(DEFAULT_AI_BUILDER_SYSTEM_PROMPT);
    setResponseInstructions(DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS);
  }, []);

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
    bundleSuggestion,
    buildGenerationMetadata,
    canCreateJob,
    generation,
    isEdited,
    mode,
    onClose,
    parseEditorValue,
    provider,
    pushToast,
    refreshResources
  ]);

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
    generation,
    isEdited,
    jobDrafts,
    mode,
    onClose,
    onWorkflowSubmitted,
    parseEditorValue,
    provider,
    pushToast,
    refreshResources,
    validation.errors.length
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

  useEffect(() => {
    if (!open) {
      return;
    }
    void refreshContextPreview(provider, mode);
  }, [mode, open, provider, refreshContextPreview]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const persisted = readPersisted();
    if (!persisted) {
      return;
    }

    setPending(true);
    setGenerationContext({ kind: 'primary', mode: persisted.mode });

    fetchAiGeneration(authorizedFetch, persisted.id)
      .then((state) => {
        setGeneration(state);
        setContextPreview(state.contextPreview ?? state.result?.contextPreview ?? null);
        setProvider(state.provider);
        setMetadataSummary(state.metadataSummary ?? '');
        setStdout(state.stdout ?? '');
        setStderr(state.stderr ?? '');
        setSummaryText(state.summary ?? null);
        if (state.status === 'running') {
          pollTimerRef.current = setTimeout(async function poll() {
            try {
              const next = await fetchAiGeneration(authorizedFetch, state.generationId);
              setGeneration(next);
              setContextPreview(next.contextPreview ?? next.result?.contextPreview ?? null);
              setProvider(next.provider);
              setMetadataSummary(next.metadataSummary ?? '');
              setStdout(next.stdout ?? '');
              setStderr(next.stderr ?? '');
              setSummaryText(next.summary ?? null);

              if (next.status === 'running') {
                pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
              } else if (next.status === 'succeeded' && next.result) {
                applyGenerationResult(next.result, generationContext ?? { kind: 'primary', mode: next.mode });
                if (!generationContext || generationContext.kind !== 'dependency') {
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
              const message = err instanceof Error ? err.message : 'Failed to poll AI generation';
              handleGenerationFailure(generationContext, message);
              setPending(false);
              clearPersistedGeneration();
              setGenerationContext(null);
            }
          }, POLL_INTERVAL_MS);
        } else if (state.status === 'succeeded' && state.result) {
          applyGenerationResult(state.result, generationContext ?? { kind: 'primary', mode: state.mode });
          setHasSuggestion(true);
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else if (state.status === 'failed') {
          const providerName = providerDisplayName(state.provider);
          const failureMessage = state.error ?? `${providerName} generation failed`;
          setError(failureMessage);
          setPending(false);
          clearPersistedGeneration();
          setGenerationContext(null);
        } else {
          setPending(false);
          setGenerationContext(null);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to resume AI generation';
        setError(message);
        setPending(false);
        clearPersistedGeneration();
        setGenerationContext(null);
      });

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [
    applyGenerationResult,
    authorizedFetch,
    clearPersistedGeneration,
    generationContext,
    handleGenerationFailure,
    open,
    providerDisplayName,
    readPersisted
  ]);

  const activeProvider = generation?.provider ?? provider;
  const providerSelectionLabel = providerDisplayName(provider);
  const activeProviderLabel = providerDisplayName(activeProvider);
  const providerHasLogs = activeProvider === 'codex';
  const providerLogTitle =
    activeProvider === 'openai'
      ? 'OpenAI response log'
      : activeProvider === 'openrouter'
      ? 'OpenRouter response log'
      : 'Codex CLI logs';

  const bundleDrafts = jobDrafts.filter((draft) => draft.mode === 'job-with-bundle');
  const allJobDraftsReady =
    bundleDrafts.length === 0 ||
    bundleDrafts.every(
      (draft) => draft.created && draft.bundleErrors.length === 0 && draft.validation.valid && !draft.creating
    );

  const canSubmit = useMemo(() => {
    if (!validation.valid || pending || submitting || editorValue.trim().length === 0) {
      return false;
    }
    if (mode === 'job-with-bundle') {
      return Boolean(bundleSuggestion) && bundleValidation.valid && canCreateJob;
    }
    if (mode === 'job') {
      return false;
    }
    if (mode === 'workflow-with-jobs') {
      return allJobDraftsReady;
    }
    return true;
  }, [
    allJobDraftsReady,
    bundleSuggestion,
    bundleValidation.valid,
    canCreateJob,
    editorValue,
    mode,
    pending,
    submitting,
    validation.valid
  ]);

  const state: AiBuilderDialogState = {
    provider,
    mode,
    prompt,
    additionalNotes,
    systemPrompt,
    responseInstructions,
    pending,
    submitting,
    error,
    metadataSummary,
    stdout,
    stderr,
    summaryText,
    editorValue,
    validation,
    hasSuggestion,
    contextPreview,
    contextLoading,
    contextError,
    bundleSuggestion,
    bundleValidation,
    plan,
    jobDrafts,
    workflowNotes,
    generation,
    canSubmit,
    canCreateJob,
    providerRequiresKey,
    providerKeyHint,
    providerSelectionLabel,
    activeProviderLabel,
    providerHasLogs,
    providerLogTitle,
    isEdited,
    promptsCustomized
  };

  const handlers: AiBuilderDialogHandlers = {
    handleDismiss,
    handleProviderChange,
    handleModeChange,
    handlePromptChange,
    handleAdditionalNotesChange,
    handleSystemPromptChange,
    handleResponseInstructionsChange,
    handleResetPrompts,
    handleGenerate,
    handleEditorChange,
    handleSubmitWorkflow,
    handleSubmitJob,
    handleOpenInBuilder,
    handleJobDraftChange,
    handleJobPromptChange,
    handleGenerateDependency,
    handleCreateDraftJob
  };

  return {
    state,
    handlers,
    helpers: {
      providerKeyMissing,
      providerDisplayName
    }
  };
}
