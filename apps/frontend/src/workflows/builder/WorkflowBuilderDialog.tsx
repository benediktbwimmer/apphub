import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from 'react';
import { FormSection, FormField, FormActions, FormButton, FormFeedback } from '../../components/form';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { Modal } from '../../components';
import { useWorkflowResources } from '../WorkflowResourcesContext';
import type { WorkflowDefinition, WorkflowDraft, WorkflowDraftStep } from '../types';
import {
  listJobBundleVersions,
  type JobBundleVersionSummary,
  type WorkflowCreateInput,
  type WorkflowUpdateInput
} from '../api';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import {
  createEmptyDraft,
  workflowDefinitionToDraft,
  draftToCreateInput,
  draftToUpdateInput,
  validateWorkflowDraft,
  computeDraftDiff,
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
  workflowCreateInputToDraft,
  type DraftValidation,
  type DiffEntry
} from './state';
import WorkflowStepCard, { type BundleVersionState } from './WorkflowStepCard';

const CREATE_AUTOSAVE_KEY = 'apphub.workflowBuilder.create';
const EDIT_AUTOSAVE_PREFIX = 'apphub.workflowBuilder.edit.';

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString();
}

type SubmitArgs = {
  draft: WorkflowDraft;
  createPayload: WorkflowCreateInput;
  updatePayload: WorkflowUpdateInput | null;
};

type WorkflowBuilderDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  workflow?: WorkflowDefinition | null;
  onClose: () => void;
  onSubmit: (input: SubmitArgs) => Promise<void>;
  submitting?: boolean;
  prefillCreatePayload?: WorkflowCreateInput | null;
};

export function WorkflowBuilderDialog({
  open,
  mode,
  workflow = null,
  onClose,
  onSubmit,
  submitting = false,
  prefillCreatePayload = null
}: WorkflowBuilderDialogProps) {
  const { jobs, services, loading: resourcesLoading, error: resourcesError, refresh } = useWorkflowResources();
  const authorizedFetch = useAuthorizedFetch();
  const [draft, setDraft] = useState<WorkflowDraft>(() => createEmptyDraft());
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bundleVersionState, setBundleVersionState] = useState<Record<string, BundleVersionState>>({});

  const autosaveKey = mode === 'create'
    ? CREATE_AUTOSAVE_KEY
    : `${EDIT_AUTOSAVE_PREFIX}${workflow?.slug ?? 'draft'}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    const stored = loadDraftFromStorage(autosaveKey);
    if (stored) {
      setDraft(stored);
      setRestoredDraft(true);
      return;
    }
    if (mode === 'edit' && workflow) {
      setDraft(workflowDefinitionToDraft(workflow));
      setRestoredDraft(false);
      return;
    }
    if (mode === 'create' && prefillCreatePayload) {
      setDraft(workflowCreateInputToDraft(prefillCreatePayload));
      setRestoredDraft(false);
      return;
    }
    setDraft(createEmptyDraft());
    setRestoredDraft(false);
  }, [open, autosaveKey, mode, workflow, prefillCreatePayload]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = window.setTimeout(() => {
      try {
        saveDraftToStorage(autosaveKey, mode, draft);
        setLastSavedAt(new Date().toISOString());
        setAutosaveError(null);
      } catch {
        setAutosaveError('Failed to persist draft locally.');
      }
    }, 900);
    return () => window.clearTimeout(handle);
  }, [draft, autosaveKey, mode, open]);

  const validation: DraftValidation = useMemo(
    () => validateWorkflowDraft(draft, jobs),
    [draft, jobs]
  );

  const diffEntries: DiffEntry[] = useMemo(
    () => computeDraftDiff(mode === 'edit' ? workflow : null, draft),
    [draft, mode, workflow]
  );

  const previewSpec = useMemo(() => draftToCreateInput(draft), [draft]);

  const ensureBundleVersions = useCallback(
    async (slug: string): Promise<JobBundleVersionSummary[]> => {
      const normalized = slug.trim().toLowerCase();
      if (!normalized) {
        return [];
      }

      setBundleVersionState((current) => {
        const existing = current[normalized];
        if (existing && (existing.loading || (existing.error === null && existing.versions.length > 0))) {
          return current;
        }
        return {
          ...current,
          [normalized]: {
            versions: existing?.versions ?? [],
            loading: true,
            error: null
          }
        } satisfies Record<string, BundleVersionState>;
      });

      try {
        const versions = await listJobBundleVersions(authorizedFetch, normalized);
        setBundleVersionState((current) => ({
          ...current,
          [normalized]: {
            versions,
            loading: false,
            error: null
          }
        }));
        return versions;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load bundle versions.';
        setBundleVersionState((current) => ({
          ...current,
          [normalized]: {
            versions: current[normalized]?.versions ?? [],
            loading: false,
            error: message
          }
        }));
        return [];
      }
    },
    [authorizedFetch]
  );

  const handleTagsChange = (value: string) => {
    const tags = value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    setDraft((current) => ({ ...current, tagsInput: value, tags }));
  };

  const handleSchemaChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDraft((current) => ({
        ...current,
        parametersSchema: {},
        parametersSchemaText: value,
        parametersSchemaError: null
      }));
      return;
    }
    try {
      const parsed = JSON.parse(value);
      setDraft((current) => ({
        ...current,
        parametersSchema: parsed,
        parametersSchemaText: value,
        parametersSchemaError: null
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setDraft((current) => ({ ...current, parametersSchemaText: value, parametersSchemaError: message }));
    }
  };

  const handleDefaultParametersChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDraft((current) => ({
        ...current,
        defaultParameters: {},
        defaultParametersText: value,
        defaultParametersError: null
      }));
      return;
    }
    try {
      const parsed = JSON.parse(value);
      setDraft((current) => ({
        ...current,
        defaultParameters: parsed,
        defaultParametersText: value,
        defaultParametersError: null
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setDraft((current) => ({ ...current, defaultParametersText: value, defaultParametersError: message }));
    }
  };

  const generateStepId = useCallback((base: string) => {
    const existing = new Set(draft.steps.map((step) => step.id));
    let counter = draft.steps.length + 1;
    const prefix = base || 'step';
    let candidate = `${prefix}-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${prefix}-${counter}`;
    }
    return candidate;
  }, [draft.steps]);

  const addStep = () => {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: generateStepId('step'),
          name: 'Untitled step',
          type: 'job',
          jobSlug: '',
          serviceSlug: undefined,
          description: '',
          dependsOn: [],
          parameters: {},
          timeoutMs: null,
          retryPolicy: null,
          storeResultAs: undefined,
          requireHealthy: undefined,
          allowDegraded: undefined,
          captureResponse: undefined,
          storeResponseAs: undefined,
          request: undefined,
          parametersText: '{}\n',
          parametersError: null
        }
      ]
    }));
  };

  const updateStep = useCallback(
    (stepId: string, updater: (current: WorkflowDraftStep) => WorkflowDraftStep) => {
      setDraft((current) => {
        const index = current.steps.findIndex((step) => step.id === stepId);
        if (index === -1) {
          return current;
        }
        const existing = current.steps[index];
        const nextStep = updater(existing);
        let steps = current.steps.slice();
        steps[index] = nextStep;
        if (existing.id !== nextStep.id) {
          steps = steps.map((step, idx) => {
            if (idx === index) {
              return nextStep;
            }
            if (!step.dependsOn || step.dependsOn.length === 0) {
              return step;
            }
            if (!step.dependsOn.includes(existing.id)) {
              return step;
            }
            return {
              ...step,
              dependsOn: step.dependsOn.map((dep) => (dep === existing.id ? nextStep.id : dep))
            };
          });
        }
        return { ...current, steps };
      });
    },
    []
  );

  const removeStep = (stepId: string) => {
    setDraft((current) => {
      const steps = current.steps.filter((step) => step.id !== stepId);
      const cleaned = steps.map((step) =>
        step.dependsOn && step.dependsOn.includes(stepId)
          ? { ...step, dependsOn: step.dependsOn.filter((dep) => dep !== stepId) }
          : step
      );
      return { ...current, steps: cleaned };
    });
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    setDraft((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      if (index === -1) {
        return current;
      }
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.steps.length) {
        return current;
      }
      const steps = current.steps.slice();
      const [moving] = steps.splice(index, 1);
      steps.splice(targetIndex, 0, moving);
      return { ...current, steps };
    });
  };

  const clearAutosave = () => {
    clearDraftFromStorage(autosaveKey);
    setRestoredDraft(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validation.valid) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    try {
      setSubmitError(null);
      const createPayload = draftToCreateInput(draft);
      const updatePayload = mode === 'edit' ? draftToUpdateInput(draft, workflow) : null;
      await onSubmit({ draft, createPayload, updatePayload });
      clearDraftFromStorage(autosaveKey);
      setRestoredDraft(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save workflow.';
      setSubmitError(message);
    }
  };

  if (!open) {
    return null;
  }

  const lastSavedLabel = formatTimestamp(lastSavedAt);
  const dialogTitleId = 'workflow-builder-title';

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      labelledBy={dialogTitleId}
      className="z-[999] items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-10 backdrop-blur-sm sm:px-8"
      contentClassName="mx-auto flex w-full max-w-5xl flex-col gap-6 border-0 bg-transparent p-0 shadow-none"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h2 id={dialogTitleId} className="text-2xl font-semibold text-white">
            {mode === 'create' ? 'Create workflow' : `Edit workflow: ${workflow?.name ?? draft.name}`}
          </h2>
          <p className="text-sm text-slate-200">
            Define workflow metadata, configure execution steps, and preview the resulting specification before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-200/60 bg-white/70 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Close
        </button>
      </div>

      {restoredDraft && (
        <FormFeedback tone="info">
          Restored your saved draft from this device. <button type="button" onClick={clearAutosave} className="underline">Discard draft</button>
        </FormFeedback>
      )}
      {autosaveError && <FormFeedback tone="error">{autosaveError}</FormFeedback>}
      {resourcesError && (
        <FormFeedback tone="error">
          Failed to load workflow resources. <button type="button" onClick={refresh} className="underline">Retry</button>
        </FormFeedback>
      )}

      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <FormSection>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow details</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Provide identifying information so operators can locate and manage this workflow.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Slug" hint="Unique identifier used in API requests." htmlFor="workflow-slug">
                <input
                  id="workflow-slug"
                  type="text"
                  value={draft.slug}
                  onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
                  disabled={mode === 'edit'}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:disabled:bg-slate-800"
                />
              </FormField>
              <FormField label="Display name" htmlFor="workflow-name">
                <input
                  id="workflow-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="workflow-description">
              <textarea
                id="workflow-description"
                value={draft.description ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Owner name" htmlFor="workflow-owner-name">
                <input
                  id="workflow-owner-name"
                  type="text"
                  value={draft.ownerName}
                  onChange={(event) => setDraft((current) => ({ ...current, ownerName: event.target.value }))}
                  placeholder="Team or primary owner"
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                />
              </FormField>
              <FormField label="Owner contact" htmlFor="workflow-owner-contact" hint="Email or Slack channel">
                <input
                  id="workflow-owner-contact"
                  type="text"
                  value={draft.ownerContact}
                  onChange={(event) => setDraft((current) => ({ ...current, ownerContact: event.target.value }))}
                  placeholder="ops@apphub.example"
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                />
              </FormField>
            </div>
            <FormField
              label="Tags"
              htmlFor="workflow-tags"
              hint="Separate tags with commas or newlines to help operators filter workflows"
            >
              <textarea
                id="workflow-tags"
                value={draft.tagsInput ?? ''}
                onChange={(event) => handleTagsChange(event.target.value)}
                rows={2}
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              />
            </FormField>
            <FormField label="Version note" htmlFor="workflow-version-note" hint="Document why this revision changes">
              <textarea
                id="workflow-version-note"
                value={draft.versionNote}
                onChange={(event) => setDraft((current) => ({ ...current, versionNote: event.target.value }))}
                rows={2}
                className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
              />
            </FormField>
          </FormSection>

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Steps</h3>
            <FormButton type="button" variant="secondary" onClick={addStep}>
              Add step
            </FormButton>
          </div>

          {validation.errors
            .filter((issue) => issue.path === 'steps')
            .map((issue) => (
              <FormFeedback key="steps-error" tone="error">
                {issue.message}
              </FormFeedback>
            ))}

          <div className="flex flex-col gap-4">
            {draft.steps.map((step, index) => (
              <WorkflowStepCard
                key={step.id}
                step={step}
                index={index}
                allSteps={draft.steps}
                jobs={jobs}
                services={services}
                bundleVersionState={bundleVersionState}
                onLoadBundleVersions={ensureBundleVersions}
                errors={validation.stepErrors[step.id] ?? []}
                onUpdate={(updater) => updateStep(step.id, updater)}
                onRemove={() => removeStep(step.id)}
                onMoveUp={() => moveStep(step.id, 'up')}
                onMoveDown={() => moveStep(step.id, 'down')}
              />
            ))}
            {draft.steps.length === 0 && (
              <FormFeedback tone="info">No steps yet. Add your first job or service step to continue.</FormFeedback>
            )}
          </div>

          <FormSection>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow inputs</h3>
            <div className="grid gap-6 md:grid-cols-2">
              <FormField label="Parameters schema" hint="JSON schema describing workflow parameters.">
                <textarea
                  value={draft.parametersSchemaText ?? ''}
                  onChange={(event) => handleSchemaChange(event.target.value)}
                  rows={10}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                  spellCheck={false}
                />
                {draft.parametersSchemaError && (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{draft.parametersSchemaError}</p>
                )}
              </FormField>
              <FormField label="Default parameters" hint="Optional defaults applied when launching the workflow.">
                <textarea
                  value={draft.defaultParametersText ?? ''}
                  onChange={(event) => handleDefaultParametersChange(event.target.value)}
                  rows={10}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                  spellCheck={false}
                />
                {draft.defaultParametersError && (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{draft.defaultParametersError}</p>
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow preview</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Review the derived workflow specification. Save to persist the configuration to the catalog.
            </p>
            {diffEntries.length > 0 && (
              <FormFeedback tone="info">
                <ul className="list-disc pl-5">
                  {diffEntries.map((entry) => (
                    <li key={entry.path} className="text-xs">
                      {entry.path} {entry.change === 'updated' ? 'updated' : entry.change}
                    </li>
                  ))}
                </ul>
              </FormFeedback>
            )}
            <JsonSyntaxHighlighter
              value={previewSpec}
              ariaLabel="Workflow preview JSON"
              className="w-full min-h-[320px] overflow-auto rounded-2xl border border-slate-200/70 bg-slate-950/90 px-3 py-2 text-xs font-mono text-emerald-100 focus:outline-none dark:border-slate-700/60"
            />
          </FormSection>

          {validation.errors
            .filter((issue) => issue.path !== 'steps')
            .map((issue) => (
              <FormFeedback key={issue.path} tone="error">
                {issue.message}
              </FormFeedback>
            ))}
          {submitError && <FormFeedback tone="error">{submitError}</FormFeedback>}

          <FormActions className="items-center justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {lastSavedLabel ? `Draft saved ${lastSavedLabel}` : 'Draft autosaves locally as you edit.'}
            </div>
            <div className="flex items-center gap-3">
              <FormButton type="button" variant="secondary" onClick={onClose}>
                Cancel
              </FormButton>
              <FormButton type="submit" disabled={!validation.valid || submitting || resourcesLoading}>
                {submitting ? 'Saving…' : mode === 'create' ? 'Create workflow' : 'Save changes'}
              </FormButton>
            </div>
          </FormActions>
      </form>
    </Modal>
  );
}

export default WorkflowBuilderDialog;

export type WorkflowBuilderSubmitArgs = SubmitArgs;
