import WorkflowsHeader from './components/WorkflowsHeader';
import WorkflowDefinitionsPanel from './components/WorkflowDefinitionsPanel';
import WorkflowDetailsCard from './components/WorkflowDetailsCard';
import WorkflowRunHistory from './components/WorkflowRunHistory';
import WorkflowRunDetails from './components/WorkflowRunDetails';
import ManualRunPanel from './components/ManualRunPanel';
import WorkflowGraph from './components/WorkflowGraph';
import WorkflowFilters from './components/WorkflowFilters';
import RunOutcomeChart from './components/RunOutcomeChart';
import WorkflowRunTrends from './components/WorkflowRunTrends';
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
    workflowAnalytics,
    setWorkflowAnalyticsRange,
    setWorkflowAnalyticsOutcomes,
    loadWorkflowAnalytics,
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

  const analytics = selectedSlug ? workflowAnalytics[selectedSlug] : undefined;
  const stats = analytics?.stats ?? null;
  const metrics = analytics?.metrics ?? null;
  const analyticsRangeKey = analytics?.rangeKey;
  const analyticsRange:
    | '24h'
    | '7d'
    | '30d' =
    analyticsRangeKey === '24h' || analyticsRangeKey === '7d' || analyticsRangeKey === '30d'
      ? analyticsRangeKey
      : '7d';
  const availableOutcomes = stats ? Object.keys(stats.statusCounts) : [];
  const activeOutcomes =
    analytics && analytics.outcomes.length > 0 ? analytics.outcomes : availableOutcomes;
  const analyticsHistory = analytics?.history ?? [];
  const analyticsUpdatedAt = analytics?.lastUpdated
    ? new Date(analytics.lastUpdated).toLocaleTimeString()
    : null;

  const handleRangeChange = (value: '24h' | '7d' | '30d') => {
    if (!selectedSlug) {
      return;
    }
    setWorkflowAnalyticsRange(selectedSlug, value);
  };

  const handleOutcomeChange = (next: string[]) => {
    if (!selectedSlug) {
      return;
    }
    setWorkflowAnalyticsOutcomes(selectedSlug, next);
  };

  const rangeOptions: Array<{ value: '24h' | '7d' | '30d'; label: string }> = [
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' }
  ];

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

          {workflowDetail && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-900/40">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700/50 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Run analytics</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Live snapshots of workflow performance.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Time range
                    <select
                      className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      value={analyticsRange}
                      onChange={(event) => handleRangeChange(event.target.value as '24h' | '7d' | '30d')}
                    >
                      {rangeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {analyticsUpdatedAt && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      Updated {analyticsUpdatedAt}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid gap-6 p-4 lg:grid-cols-2">
                <RunOutcomeChart
                  stats={stats}
                  selectedOutcomes={activeOutcomes}
                  onChange={handleOutcomeChange}
                />
                <WorkflowRunTrends
                  metrics={metrics}
                  history={analyticsHistory}
                  selectedOutcomes={activeOutcomes}
                />
              </div>
            </div>
          )}

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
