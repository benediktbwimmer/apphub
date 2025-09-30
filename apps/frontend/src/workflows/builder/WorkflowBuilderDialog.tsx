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

const MODAL_BACKDROP_CLASSES =
  'workflow-dialog-backdrop z-[999] items-start justify-center overflow-y-auto px-4 py-10 backdrop-blur-sm sm:px-8';

const SECTION_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const SECTION_SUBTEXT_CLASSES = 'text-scale-sm text-secondary';

const INPUT_FIELD_CLASSES =
  'w-full rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const TEXTAREA_FIELD_CLASSES = `${INPUT_FIELD_CLASSES} min-h-[72px]`;

const HEADER_TITLE_CLASSES = 'text-scale-xl font-weight-semibold text-inverse';

const HEADER_SUBTEXT_CLASSES = 'text-scale-sm text-inverse opacity-80';

const CLOSE_BUTTON_CLASSES =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const STEPS_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-inverse';

const MONO_TEXTAREA_CLASSES =
  'w-full rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-mono text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const PREVIEW_CODE_CLASSES =
  'w-full min-h-[320px] overflow-auto rounded-2xl border border-subtle bg-surface-sunken px-3 py-2 text-scale-xs font-mono text-inverse focus:outline-none';

const FOOTER_TEXT_CLASSES = 'text-scale-xs text-muted';


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
      className={MODAL_BACKDROP_CLASSES}
      contentClassName="mx-auto flex w-full max-w-5xl flex-col gap-6 border-0 bg-transparent p-0 shadow-none"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h2 id={dialogTitleId} className={HEADER_TITLE_CLASSES}>
            {mode === 'create' ? 'Create workflow' : `Edit workflow: ${workflow?.name ?? draft.name}`}
          </h2>
          <p className={HEADER_SUBTEXT_CLASSES}>
            Define workflow metadata, configure execution steps, and preview the resulting specification before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={CLOSE_BUTTON_CLASSES}
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
            <h3 className={SECTION_TITLE_CLASSES}>Workflow details</h3>
            <p className={SECTION_SUBTEXT_CLASSES}>
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
                  className={INPUT_FIELD_CLASSES}
                />
              </FormField>
              <FormField label="Display name" htmlFor="workflow-name">
                <input
                  id="workflow-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className={INPUT_FIELD_CLASSES}
                />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="workflow-description">
              <textarea
                id="workflow-description"
                value={draft.description ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                className={TEXTAREA_FIELD_CLASSES}
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
                  className={INPUT_FIELD_CLASSES}
                />
              </FormField>
              <FormField label="Owner contact" htmlFor="workflow-owner-contact" hint="Email or Slack channel">
                <input
                  id="workflow-owner-contact"
                  type="text"
                  value={draft.ownerContact}
                  onChange={(event) => setDraft((current) => ({ ...current, ownerContact: event.target.value }))}
                  placeholder="ops@apphub.example"
                  className={INPUT_FIELD_CLASSES}
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
                className={TEXTAREA_FIELD_CLASSES}
              />
            </FormField>
            <FormField label="Version note" htmlFor="workflow-version-note" hint="Document why this revision changes">
              <textarea
                id="workflow-version-note"
                value={draft.versionNote}
                onChange={(event) => setDraft((current) => ({ ...current, versionNote: event.target.value }))}
                rows={2}
                className={TEXTAREA_FIELD_CLASSES}
              />
            </FormField>
          </FormSection>

          <div className="flex items-center justify-between">
            <h3 className={STEPS_TITLE_CLASSES}>Steps</h3>
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
            <h3 className={SECTION_TITLE_CLASSES}>Workflow inputs</h3>
            <div className="grid gap-6 md:grid-cols-2">
              <FormField label="Parameters schema" hint="JSON schema describing workflow parameters.">
                <textarea
                  value={draft.parametersSchemaText ?? ''}
                  onChange={(event) => handleSchemaChange(event.target.value)}
                  rows={10}
                  className={MONO_TEXTAREA_CLASSES}
                  spellCheck={false}
                />
                {draft.parametersSchemaError && (
                  <p className="text-scale-xs font-weight-semibold text-status-danger">{draft.parametersSchemaError}</p>
                )}
              </FormField>
              <FormField label="Default parameters" hint="Optional defaults applied when launching the workflow.">
                <textarea
                  value={draft.defaultParametersText ?? ''}
                  onChange={(event) => handleDefaultParametersChange(event.target.value)}
                  rows={10}
                  className={MONO_TEXTAREA_CLASSES}
                  spellCheck={false}
                />
                {draft.defaultParametersError && (
                  <p className="text-scale-xs font-weight-semibold text-status-danger">{draft.defaultParametersError}</p>
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection>
            <h3 className={SECTION_TITLE_CLASSES}>Workflow preview</h3>
            <p className={SECTION_SUBTEXT_CLASSES}>
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
              className={PREVIEW_CODE_CLASSES}
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
            <div className={FOOTER_TEXT_CLASSES}>
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
