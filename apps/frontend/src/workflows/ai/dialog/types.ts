import type { FormEvent } from 'react';
import type {
  AiBuilderMode,
  AiBuilderProvider,
  AiGenerationState,
  AiWorkflowPlan,
  AiContextPreview
} from '../api';
import type {
  AuthorizedFetch,
  WorkflowCreateInput
} from '../../api';
import type { WorkflowDefinition } from '../../types';
import type { ToastPayload } from '../../../components/toast/ToastContext';
import type { AiBundleSuggestion } from '../api';

export type JobDraftMode = Extract<AiBuilderMode, 'job' | 'job-with-bundle'>;

export type JobDraft = {
  id: string;
  slug: string;
  mode: JobDraftMode;
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

export type DependencyMode = Extract<AiBuilderMode, 'job' | 'job-with-bundle'>;

export type GenerationContext =
  | { kind: 'primary'; mode: AiBuilderMode }
  | { kind: 'dependency'; dependencyId: string; mode: DependencyMode };

export type AiBuilderDialogProps = {
  open: boolean;
  onClose: () => void;
  authorizedFetch: AuthorizedFetch;
  pushToast: (toast: ToastPayload) => void;
  onWorkflowSubmitted: (workflow: WorkflowDefinition) => Promise<void> | void;
  onWorkflowPrefill: (spec: WorkflowCreateInput) => void;
  canCreateJob: boolean;
};

type BundleValidation = { valid: boolean; errors: string[] };

type ValidationState = { valid: boolean; errors: string[] };

export type AiBuilderDialogState = {
  provider: AiBuilderProvider;
  mode: AiBuilderMode;
  prompt: string;
  additionalNotes: string;
  systemPrompt: string;
  responseInstructions: string;
  pending: boolean;
  submitting: boolean;
  error: string | null;
  metadataSummary: string;
  stdout: string;
  stderr: string;
  summaryText: string | null;
  editorValue: string;
  validation: ValidationState;
  hasSuggestion: boolean;
  contextPreview: AiContextPreview | null;
  contextLoading: boolean;
  contextError: string | null;
  bundleSuggestion: AiBundleSuggestion | null;
  bundleValidation: BundleValidation;
  plan: AiWorkflowPlan | null;
  jobDrafts: JobDraft[];
  workflowNotes: string | null;
  generation: AiGenerationState | null;
  canSubmit: boolean;
  canCreateJob: boolean;
  providerRequiresKey: boolean;
  providerKeyHint: string | null;
  providerSelectionLabel: string;
  activeProviderLabel: string;
  providerHasLogs: boolean;
  providerLogTitle: string;
  isEdited: boolean;
  promptsCustomized: boolean;
};

export type AiBuilderDialogHandlers = {
  handleDismiss: () => void;
  handleProviderChange: (next: AiBuilderProvider) => void;
  handleModeChange: (next: AiBuilderMode) => void;
  handlePromptChange: (value: string) => void;
  handleAdditionalNotesChange: (value: string) => void;
  handleSystemPromptChange: (value: string) => void;
  handleResponseInstructionsChange: (value: string) => void;
  handleResetPrompts: () => void;
  handleGenerate: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
  handleEditorChange: (value: string) => void;
  handleSubmitWorkflow: () => Promise<void>;
  handleSubmitJob: () => Promise<void>;
  handleOpenInBuilder: () => void;
  handleJobDraftChange: (draftId: string, value: string) => void;
  handleJobPromptChange: (draftId: string, value: string) => void;
  handleGenerateDependency: (dependencyId: string) => Promise<void>;
  handleCreateDraftJob: (draftId: string) => Promise<void>;
};
