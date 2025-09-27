import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useWorkflowDefinitions } from './useWorkflowDefinitions';
import { useWorkflowRuns } from './useWorkflowRuns';
import {
  createWorkflowDefinition,
  updateWorkflowDefinition,
  type WorkflowCreateInput
} from '../api';
import type { WorkflowDefinition } from '../types';
import type { WorkflowBuilderSubmitArgs } from '../builder/WorkflowBuilderDialog';
import { ApiError } from '../api';

export type WorkflowBuilderContextValue = {
  builderOpen: boolean;
  builderMode: 'create' | 'edit';
  builderWorkflow: WorkflowDefinition | null;
  builderSubmitting: boolean;
  aiBuilderOpen: boolean;
  setAiBuilderOpen: (open: boolean) => void;
  aiPrefillWorkflow: WorkflowCreateInput | null;
  canEditWorkflows: boolean;
  canUseAiBuilder: boolean;
  canCreateAiJobs: boolean;
  handleOpenAiBuilder: () => void;
  handleAiWorkflowPrefill: (input: WorkflowCreateInput) => void;
  handleOpenCreateBuilder: () => void;
  handleOpenEditBuilder: () => void;
  handleBuilderClose: () => void;
  handleBuilderSubmit: (input: WorkflowBuilderSubmitArgs) => Promise<void>;
  handleAiWorkflowSubmitted: (workflow: WorkflowDefinition) => Promise<void>;
};

const WorkflowBuilderContext = createContext<WorkflowBuilderContextValue | undefined>(undefined);

export function WorkflowBuilderProvider({ children }: { children: ReactNode }) {
  const {
    authorizedFetch,
    pushToast,
    canEditWorkflows,
    canUseAiBuilder,
    canCreateAiJobs
  } = useWorkflowAccess();
  const {
    loadWorkflows,
    setSelectedSlug
  } = useWorkflowDefinitions();
  const { workflowDetail, loadWorkflowDetail } = useWorkflowRuns();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<'create' | 'edit'>('create');
  const [builderWorkflow, setBuilderWorkflow] = useState<WorkflowDefinition | null>(null);
  const [builderSubmitting, setBuilderSubmitting] = useState(false);
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [aiPrefillWorkflow, setAiPrefillWorkflow] = useState<WorkflowCreateInput | null>(null);

  const handleOpenAiBuilder = useCallback(() => {
    if (!canUseAiBuilder) {
      return;
    }
    setAiBuilderOpen(true);
    console.info('ai-builder.usage', { event: 'opened', source: 'workflows-page' });
  }, [canUseAiBuilder]);

  const handleAiWorkflowPrefill = useCallback((spec: WorkflowCreateInput) => {
    setAiPrefillWorkflow(spec);
    setBuilderMode('create');
    setBuilderWorkflow(null);
    setBuilderOpen(true);
  }, []);

  const handleBuilderClose = useCallback(() => {
    setBuilderOpen(false);
    setAiPrefillWorkflow(null);
  }, []);

  const handleOpenCreateBuilder = useCallback(() => {
    if (!canEditWorkflows) {
      return;
    }
    setBuilderMode('create');
    setBuilderWorkflow(null);
    setBuilderOpen(true);
  }, [canEditWorkflows]);

  const handleOpenEditBuilder = useCallback(() => {
    if (!canEditWorkflows) {
      return;
    }
    const detail = workflowDetail;
    if (!detail) {
      return;
    }
    setBuilderMode('edit');
    setBuilderWorkflow(detail);
    setBuilderOpen(true);
  }, [canEditWorkflows, workflowDetail]);

  const handleBuilderSubmit = useCallback(
    async (input: WorkflowBuilderSubmitArgs) => {
      setBuilderSubmitting(true);
      try {
        if (builderMode === 'create') {
          const created = await createWorkflowDefinition(authorizedFetch, input.createPayload);
          pushToast({
            tone: 'success',
            title: 'Workflow created',
            description: `${created.name} is ready for runs.`
          });
          setBuilderOpen(false);
          setBuilderWorkflow(null);
          setAiPrefillWorkflow(null);
          await loadWorkflows();
          setSelectedSlug(created.slug);
          await loadWorkflowDetail(created.slug);
        } else if (builderMode === 'edit' && builderWorkflow) {
          const updates = input.updatePayload ?? {};
          const updated = await updateWorkflowDefinition(authorizedFetch, builderWorkflow.slug, updates);
          pushToast({
            tone: 'success',
            title: 'Workflow updated',
            description: `${updated.name} changes saved.`
          });
          setBuilderOpen(false);
          setBuilderWorkflow(updated);
          setAiPrefillWorkflow(null);
          await loadWorkflows();
          await loadWorkflowDetail(updated.slug);
        }
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Failed to save workflow.';
        pushToast({ tone: 'error', title: 'Workflow save failed', description: message });
        throw error;
      } finally {
        setBuilderSubmitting(false);
      }
    },
    [
      authorizedFetch,
      builderMode,
      builderWorkflow,
      loadWorkflowDetail,
      loadWorkflows,
      pushToast,
      setSelectedSlug
    ]
  );

  const handleAiWorkflowSubmitted = useCallback(
    async (workflowCreated: WorkflowDefinition) => {
      await loadWorkflows();
      setSelectedSlug(workflowCreated.slug);
      await loadWorkflowDetail(workflowCreated.slug);
    },
    [loadWorkflows, loadWorkflowDetail, setSelectedSlug]
  );

  const value = useMemo<WorkflowBuilderContextValue>(
    () => ({
      builderOpen,
      builderMode,
      builderWorkflow,
      builderSubmitting,
      aiBuilderOpen,
      setAiBuilderOpen,
      aiPrefillWorkflow,
      canEditWorkflows,
      canUseAiBuilder,
      canCreateAiJobs,
      handleOpenAiBuilder,
      handleAiWorkflowPrefill,
      handleOpenCreateBuilder,
      handleOpenEditBuilder,
      handleBuilderClose,
      handleBuilderSubmit,
      handleAiWorkflowSubmitted
    }),
    [
      builderOpen,
      builderMode,
      builderWorkflow,
      builderSubmitting,
      aiBuilderOpen,
      aiPrefillWorkflow,
      canEditWorkflows,
      canUseAiBuilder,
      canCreateAiJobs,
      handleOpenAiBuilder,
      handleAiWorkflowPrefill,
      handleOpenCreateBuilder,
      handleOpenEditBuilder,
      handleBuilderClose,
      handleBuilderSubmit,
      handleAiWorkflowSubmitted
    ]
  );

  return <WorkflowBuilderContext.Provider value={value}>{children}</WorkflowBuilderContext.Provider>;
}

export function useWorkflowBuilder() {
  const context = useContext(WorkflowBuilderContext);
  if (!context) {
    throw new Error('useWorkflowBuilder must be used within WorkflowBuilderProvider');
  }
  return context;
}
