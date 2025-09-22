import WorkflowsHeader from './components/WorkflowsHeader';
import WorkflowDefinitionsPanel from './components/WorkflowDefinitionsPanel';
import WorkflowDetailsCard from './components/WorkflowDetailsCard';
import WorkflowRunHistory from './components/WorkflowRunHistory';
import WorkflowRunDetails from './components/WorkflowRunDetails';
import ManualRunPanel from './components/ManualRunPanel';
import WorkflowGraph from './components/WorkflowGraph';
import WorkflowFilters from './components/WorkflowFilters';
import { WorkflowResourcesProvider } from './WorkflowResourcesContext';
import WorkflowBuilderDialog from './builder/WorkflowBuilderDialog';
import AiBuilderDialog from './ai/AiBuilderDialog';
import { INITIAL_FILTERS, useWorkflowsController } from './hooks/useWorkflowsController';

export default function WorkflowsPage() {
  const {
    workflows,
    workflowsLoading,
    workflowsError,
    filteredSummaries,
    filteredWorkflows,
    filters,
    setFilters,
    searchTerm,
    setSearchTerm,
    statusOptions,
    repoOptions,
    serviceOptions,
    tagOptions,
    selectedSlug,
    setSelectedSlug,
    workflowDetail,
    detailLoading,
    detailError,
    runs,
    selectedRun,
    selectedRunId,
    setSelectedRunId,
    runSteps,
    stepsLoading,
    stepsError,
    workflowRuntimeSummaries,
    manualRunPending,
    manualRunError,
    lastTriggeredRun,
    handleManualRun,
    handleRefresh,
    unreachableServiceSlugs,
    builderOpen,
    builderMode,
    builderWorkflow,
    builderSubmitting,
    canEditWorkflows,
    canUseAiBuilder,
    canCreateAiJobs,
    aiBuilderOpen,
    setAiBuilderOpen,
    aiPrefillWorkflow,
    handleOpenAiBuilder,
    handleOpenCreateBuilder,
    handleOpenEditBuilder,
    handleBuilderClose,
    handleBuilderSubmit,
    handleAiWorkflowPrefill,
    handleAiWorkflowSubmitted,
    loadWorkflowDetail,
    hasActiveToken,
    authorizedFetch,
    pushToast
  } = useWorkflowsController();

  return (
    <div className="flex flex-col gap-6">
      <WorkflowsHeader
        canUseAiBuilder={canUseAiBuilder}
        onOpenAiBuilder={handleOpenAiBuilder}
        canEditWorkflows={canEditWorkflows}
        onOpenCreateWorkflow={handleOpenCreateBuilder}
        onRefresh={handleRefresh}
      />

      {!hasActiveToken && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          Save an operator token in the API Access tab to enable workflow mutations and manual runs.
        </div>
      )}

      <WorkflowFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        activeFilters={filters}
        onChange={setFilters}
        statusOptions={statusOptions}
        repoOptions={repoOptions}
        serviceOptions={serviceOptions}
        tagOptions={tagOptions}
        onReset={() => setFilters(INITIAL_FILTERS)}
      />

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <WorkflowDefinitionsPanel
          workflowsLoading={workflowsLoading}
          workflowsError={workflowsError}
          summaries={filteredSummaries}
          totalWorkflowCount={workflows.length}
          filteredWorkflowCount={filteredWorkflows.length}
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
        />

        <div className="flex flex-col gap-6">
          <ManualRunPanel
            workflow={workflowDetail}
            onSubmit={handleManualRun}
            pending={manualRunPending}
            error={manualRunError}
            authorized={hasActiveToken}
            lastRun={lastTriggeredRun}
            unreachableServices={unreachableServiceSlugs}
          />

          {workflowDetail && (
            <WorkflowGraph
              workflow={workflowDetail}
              run={selectedRun}
              steps={runSteps}
              runtimeSummary={workflowRuntimeSummaries[workflowDetail.slug]}
            />
          )}

          <WorkflowDetailsCard
            workflow={workflowDetail}
            loading={detailLoading}
            error={detailError}
            canEdit={canEditWorkflows}
            onEdit={handleOpenEditBuilder}
          />

          <WorkflowRunHistory
            workflow={workflowDetail}
            runs={runs}
            loading={detailLoading}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            runtimeSummary={workflowDetail ? workflowRuntimeSummaries[workflowDetail.slug] : undefined}
            onRefresh={() => {
              if (selectedSlug) {
                void loadWorkflowDetail(selectedSlug);
              }
            }}
          />

          <WorkflowRunDetails
            run={selectedRun}
            steps={runSteps}
            stepsLoading={stepsLoading}
            stepsError={stepsError}
          />
        </div>
      </div>

      {builderOpen && (
        <WorkflowResourcesProvider>
          <WorkflowBuilderDialog
            open={builderOpen}
            mode={builderMode}
            workflow={builderWorkflow}
            onClose={handleBuilderClose}
            onSubmit={handleBuilderSubmit}
            submitting={builderSubmitting}
            prefillCreatePayload={aiPrefillWorkflow}
          />
        </WorkflowResourcesProvider>
      )}

      {aiBuilderOpen && (
        <WorkflowResourcesProvider>
          <AiBuilderDialog
            open={aiBuilderOpen}
            onClose={() => setAiBuilderOpen(false)}
            authorizedFetch={authorizedFetch}
            pushToast={pushToast}
            onWorkflowSubmitted={handleAiWorkflowSubmitted}
            onWorkflowPrefill={handleAiWorkflowPrefill}
            canCreateJob={canCreateAiJobs}
          />
        </WorkflowResourcesProvider>
      )}
    </div>
  );
}
