import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorkflowsHeader from './components/WorkflowsHeader';
import WorkflowDefinitionsPanel from './components/WorkflowDefinitionsPanel';
import WorkflowDetailsCard from './components/WorkflowDetailsCard';
import WorkflowRunHistory from './components/WorkflowRunHistory';
import WorkflowRunDetails from './components/WorkflowRunDetails';
import WorkflowFilters from './components/WorkflowFilters';
import RunOutcomeChart from './components/RunOutcomeChart';
import WorkflowRunTrends from './components/WorkflowRunTrends';
import WorkflowAssetPanel from './components/WorkflowAssetPanel';
import AutoMaterializePanel from './components/AutoMaterializePanel';
import EventTriggersPanel from './components/eventTriggers/EventTriggersPanel';
import WorkflowEventTimeline from './components/WorkflowEventTimeline';
import { WorkflowResourcesProvider } from './WorkflowResourcesContext';
import WorkflowBuilderDialog from './builder/WorkflowBuilderDialog';
import AiBuilderDialog from './ai/AiBuilderDialog';
import ManualRunDialog from './components/ManualRunDialog';
import WorkflowTopologyPreview from './components/WorkflowTopologyPreview';
import { INITIAL_FILTERS, WorkflowsProviders, useWorkflowsController } from './hooks/useWorkflowsController';
import type { WorkflowTriggerDeliveriesQuery } from './api';

export default function WorkflowsPage() {
  return (
    <WorkflowsProviders>
      <WorkflowsPageContent />
    </WorkflowsProviders>
  );
}

function WorkflowsPageContent() {
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
    isAuthenticated,
    canRunWorkflowsScope,
    authorizedFetch,
    pushToast,
    assetInventory,
    assetInventoryLoading,
    assetInventoryError,
    selectedAssetId,
    assetDetail,
    assetDetailLoading,
    assetDetailError,
    assetPartitions,
    assetPartitionsLoading,
    assetPartitionsError,
    selectAsset,
    clearSelectedAsset,
    refreshAsset,
    autoMaterializeOps,
    autoMaterializeLoading,
    autoMaterializeError,
    refreshAutoMaterializeOps,
    toggleAutoMaterialize,
    autoMaterializeUpdating,
    eventTriggers,
    eventTriggersLoading,
    eventTriggersError,
    selectedEventTrigger,
    setSelectedEventTriggerId,
    createEventTrigger,
    updateEventTrigger,
    deleteEventTrigger,
    triggerDeliveries,
    triggerDeliveriesLoading,
    triggerDeliveriesError,
    triggerDeliveriesLimit,
    triggerDeliveriesQuery,
    loadTriggerDeliveries: loadTriggerDeliveriesFn,
    eventSamples,
    eventSchema,
    eventSamplesLoading,
    eventSamplesError,
    eventSamplesQuery,
    loadEventSamples: loadEventSamplesFn,
    refreshEventSamples,
    eventHealth,
    eventHealthLoading,
    eventHealthError,
    loadEventSchedulerHealth,
    cancelEventRetry,
    forceEventRetry,
    cancelTriggerRetry,
    forceTriggerRetry,
    cancelWorkflowStepRetry,
    forceWorkflowStepRetry,
    pendingEventRetryId,
    pendingTriggerRetryId,
    pendingWorkflowRetryId,
    timeline,
    timelineMeta,
    timelineLoading,
    timelineError,
    timelineRange,
    timelineStatuses,
    setTimelineRange,
    toggleTimelineStatus,
    clearTimelineStatuses,
    refreshTimeline: refreshTimelineView,
    loadMoreTimeline,
    timelineHasMore
  } = useWorkflowsController();

  const [searchParams] = useSearchParams();
  const [manualRunDialogOpen, setManualRunDialogOpen] = useState(false);

  useEffect(() => {
    const slugParam = searchParams.get('slug');
    if (slugParam && slugParam !== selectedSlug) {
      setSelectedSlug(slugParam);
    }
  }, [searchParams, selectedSlug, setSelectedSlug]);

  useEffect(() => {
    const runParam = searchParams.get('run');
    if (!runParam) {
      return;
    }
    const match = runs.find((run) => run.id === runParam || run.runKey === runParam);
    if (!match) {
      return;
    }
    if (match.id !== selectedRunId) {
      setSelectedRunId(match.id);
    }
  }, [searchParams, runs, selectedRunId, setSelectedRunId]);

  useEffect(() => {
    if (manualRunDialogOpen && lastTriggeredRun) {
      setManualRunDialogOpen(false);
    }
  }, [manualRunDialogOpen, lastTriggeredRun]);

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
  const timelineEntriesCount = timeline?.entries?.length ?? 0;
  const timelineLoadingMore = timelineLoading && timelineEntriesCount > 0;

  const deliveriesQuery: WorkflowTriggerDeliveriesQuery =
    triggerDeliveriesQuery ?? { limit: triggerDeliveriesLimit };

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

  const manualRunAuthorized = Boolean(isAuthenticated && canRunWorkflowsScope);
  const manualRunDisabledReason = !isAuthenticated
    ? 'Sign in under Settings → API Access to run workflows.'
    : !canRunWorkflowsScope
      ? 'Your account does not have permission to launch workflows.'
      : undefined;
  const launchBlockedByServices =
    workflowDetail && unreachableServiceSlugs.length > 0
      ? `Cannot launch while the following services are unreachable: ${unreachableServiceSlugs.join(', ')}`
      : undefined;
  const canLaunchWorkflow = manualRunAuthorized && !launchBlockedByServices;
  const launchDisabledReason = launchBlockedByServices ?? manualRunDisabledReason;

  const handleOpenManualRunDialog = () => {
    setManualRunDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <WorkflowsHeader
        canUseAiBuilder={canUseAiBuilder}
        onOpenAiBuilder={handleOpenAiBuilder}
        canEditWorkflows={canEditWorkflows}
        onOpenCreateWorkflow={handleOpenCreateBuilder}
        onRefresh={handleRefresh}
      />

      {!isAuthenticated ? (
        <div className="rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-xs font-weight-semibold text-status-warning shadow-elevation-md">
          Sign in under Settings → API Access to run workflows and make changes.
        </div>
      ) : !canRunWorkflowsScope ? (
        <div className="rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-xs font-weight-semibold text-status-warning shadow-elevation-md">
          Your account does not have permission to launch workflows. Contact an administrator to request access.
        </div>
      ) : null}

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
          <WorkflowTopologyPreview workflow={workflowDetail} />

          <WorkflowDetailsCard
            workflow={workflowDetail}
            loading={detailLoading}
            error={detailError}
            canEdit={canEditWorkflows}
            onEdit={handleOpenEditBuilder}
            runtimeSummary={workflowDetail ? workflowRuntimeSummaries[workflowDetail.slug] : undefined}
            onLaunch={handleOpenManualRunDialog}
            canLaunch={canLaunchWorkflow}
            launchDisabledReason={launchDisabledReason}
            launchWarning={launchBlockedByServices}
          />

          <EventTriggersPanel
            workflow={workflowDetail}
            triggers={eventTriggers}
            triggersLoading={eventTriggersLoading}
            triggersError={eventTriggersError}
            selectedTrigger={selectedEventTrigger}
            onSelectTrigger={setSelectedEventTriggerId}
            createTrigger={createEventTrigger}
            updateTrigger={updateEventTrigger}
            deleteTrigger={deleteEventTrigger}
            deliveries={triggerDeliveries}
            deliveriesLoading={triggerDeliveriesLoading}
            deliveriesError={triggerDeliveriesError}
            deliveriesLimit={triggerDeliveriesLimit}
            deliveriesQuery={deliveriesQuery}
            onReloadDeliveries={(query: WorkflowTriggerDeliveriesQuery) => {
              if (workflowDetail && selectedEventTrigger) {
                void loadTriggerDeliveriesFn(workflowDetail.slug, selectedEventTrigger.id, query);
              }
            }}
            eventHealth={eventHealth}
            eventHealthLoading={eventHealthLoading}
            eventHealthError={eventHealthError}
            onRefreshEventHealth={loadEventSchedulerHealth}
            eventSamples={eventSamples}
            eventSchema={eventSchema}
            eventSamplesLoading={eventSamplesLoading}
            eventSamplesError={eventSamplesError}
            eventSamplesQuery={eventSamplesQuery}
            loadEventSamples={loadEventSamplesFn}
            refreshEventSamples={refreshEventSamples}
            canEdit={canEditWorkflows}
            onCancelEventRetry={cancelEventRetry}
            onForceEventRetry={forceEventRetry}
            onCancelTriggerRetry={cancelTriggerRetry}
            onForceTriggerRetry={forceTriggerRetry}
            onCancelWorkflowRetry={cancelWorkflowStepRetry}
            onForceWorkflowRetry={forceWorkflowStepRetry}
            pendingEventRetryId={pendingEventRetryId}
            pendingTriggerRetryId={pendingTriggerRetryId}
            pendingWorkflowRetryId={pendingWorkflowRetryId}
          />

          <WorkflowEventTimeline
            snapshot={timeline}
            meta={timelineMeta}
            loading={timelineLoading}
            loadingMore={timelineLoadingMore}
            hasMore={timelineHasMore}
            error={timelineError}
            range={timelineRange}
            statuses={timelineStatuses}
            onChangeRange={setTimelineRange}
            onToggleStatus={toggleTimelineStatus}
            onResetStatuses={clearTimelineStatuses}
            onRefresh={refreshTimelineView}
            onLoadMore={loadMoreTimeline}
          />

          <AutoMaterializePanel
            ops={autoMaterializeOps}
            loading={autoMaterializeLoading}
            error={autoMaterializeError}
            onRefresh={() => {
              if (selectedSlug) {
                refreshAutoMaterializeOps(selectedSlug);
              }
            }}
            assetInventory={assetInventory}
          />

          <WorkflowAssetPanel
            assets={assetInventory}
            loading={assetInventoryLoading}
            error={assetInventoryError}
            selectedAssetId={selectedAssetId}
            onSelectAsset={selectAsset}
            onClearSelection={clearSelectedAsset}
            assetDetail={assetDetail}
            assetDetailLoading={assetDetailLoading}
            assetDetailError={assetDetailError}
            assetPartitions={assetPartitions}
            assetPartitionsLoading={assetPartitionsLoading}
            assetPartitionsError={assetPartitionsError}
            onRefreshAssetDetail={refreshAsset}
            onToggleAutoMaterialize={toggleAutoMaterialize}
            autoMaterializeUpdating={autoMaterializeUpdating}
          />

          {workflowDetail && (
            <div className="rounded-2xl border border-subtle bg-surface-glass shadow-elevation-md">
              <div className="flex flex-col gap-3 border-b border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-scale-sm font-weight-semibold text-primary">Run analytics</h3>
                  <p className="text-scale-xs text-secondary">
                    Live snapshots of workflow performance.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-scale-xs font-weight-medium text-secondary">
                    Time range
                    <select
                      className="rounded-xl border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs font-weight-medium text-secondary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                    <span className="text-scale-xs text-muted">Updated {analyticsUpdatedAt}</span>
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

      <ManualRunDialog
        open={manualRunDialogOpen}
        workflow={workflowDetail}
        onClose={() => setManualRunDialogOpen(false)}
        onSubmit={handleManualRun}
        pending={manualRunPending}
        error={manualRunError}
        authorized={manualRunAuthorized}
        lastRun={lastTriggeredRun}
        unreachableServices={unreachableServiceSlugs}
      />
    </div>
  );
}
