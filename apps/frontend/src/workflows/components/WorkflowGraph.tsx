import { useEffect, useMemo, useState } from 'react';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep, WorkflowRuntimeSummary } from '../types';
import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge, { getStatusBadgeClasses } from './StatusBadge';

type WorkflowGraphProps = {
  workflow: WorkflowDefinition;
  run: WorkflowRun | null;
  steps: WorkflowRunStep[];
  runtimeSummary?: WorkflowRuntimeSummary;
};

type FanOutChildSummary = {
  status: string;
  count: number;
};

type PositionedFanOutChild = WorkflowRunStep & {
  durationMs: number | null;
};

type PositionedFanOut = {
  templateId: string | null;
  templateName: string | null;
  templateType: 'job' | 'service' | 'unknown';
  templateJobSlug?: string;
  templateServiceSlug?: string;
  collection?: unknown;
  maxItems: number | null;
  maxConcurrency: number | null;
  storeResultsAs?: string;
  totalChildren: number;
  statusCounts: FanOutChildSummary[];
  children: PositionedFanOutChild[];
};

type PositionedStep = {
  id: string;
  name: string;
  level: number;
  order: number;
  jobSlug?: string;
  serviceSlug?: string;
  type: 'job' | 'service' | 'fanout' | 'unknown';
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  logsUrl: string | null;
  errorMessage?: string | null;
  metrics?: unknown;
  attempt: number | null;
  jobRunId: string | null;
  parameters?: unknown;
  result?: unknown;
  context?: Record<string, unknown> | null;
  dependsOn: string[];
  fanout?: PositionedFanOut;
};

type Edge = {
  from: PositionedStep;
  to: PositionedStep;
};

const FANOUT_STATUS_ORDER = ['failed', 'running', 'pending', 'canceled', 'skipped', 'succeeded', 'unknown'] as const;
const FANOUT_CHILD_PREVIEW_LIMIT = 200;

function normalizeStatusOrder(status: string): number {
  const index = FANOUT_STATUS_ORDER.indexOf(status as (typeof FANOUT_STATUS_ORDER)[number]);
  return index === -1 ? FANOUT_STATUS_ORDER.length : index;
}

function sortStatusCounts(entries: Array<[string, number]>): FanOutChildSummary[] {
  return entries
    .sort((a, b) => {
      const orderA = normalizeStatusOrder(a[0]);
      const orderB = normalizeStatusOrder(b[0]);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      if (a[1] !== b[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([status, count]) => ({ status, count }));
}

function computeDurationMs(startedAt: string | null, completedAt: string | null, metrics: unknown): number | null {
  let duration: number | null = null;
  if (metrics && typeof metrics === 'object' && metrics !== null) {
    const record = metrics as Record<string, unknown>;
    const candidate = extractNumber(record.durationMs);
    if (candidate !== null) {
      duration = candidate;
    }
  }
  if (!duration && startedAt && completedAt) {
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      duration = end - start;
    }
  }
  return duration;
}

function compareFanoutChildren(a: PositionedFanOutChild, b: PositionedFanOutChild): number {
  const indexA = typeof a.fanoutIndex === 'number' ? a.fanoutIndex : Number.POSITIVE_INFINITY;
  const indexB = typeof b.fanoutIndex === 'number' ? b.fanoutIndex : Number.POSITIVE_INFINITY;
  if (indexA !== indexB) {
    return indexA - indexB;
  }
  const startA = a.startedAt ? Date.parse(a.startedAt) : Number.POSITIVE_INFINITY;
  const startB = b.startedAt ? Date.parse(b.startedAt) : Number.POSITIVE_INFINITY;
  if (startA !== startB) {
    return startA - startB;
  }
  return a.id.localeCompare(b.id);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractContextStep(run: WorkflowRun | null, stepId: string) {
  if (!run) {
    return null;
  }
  const context = toRecord(run.context);
  if (!context) {
    return null;
  }
  const steps = toRecord(context.steps);
  if (!steps) {
    return null;
  }
  const entry = steps[stepId];
  return toRecord(entry);
}

function extractStatusFromContext(run: WorkflowRun | null, stepId: string): string | null {
  const contextStep = extractContextStep(run, stepId);
  const status = contextStep?.status;
  return typeof status === 'string' ? status : null;
}

function extractTimestamp(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function extractNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function coalesce<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function formatStructuredValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error('Failed to stringify structured value', error);
    return String(value);
  }
}

function buildPositionedSteps(
  workflow: WorkflowDefinition,
  run: WorkflowRun | null,
  runSteps: WorkflowRunStep[]
): PositionedStep[] {
  const depends = new Map<string, string[]>();
  for (const step of workflow.steps) {
    depends.set(step.id, step.dependsOn ?? []);
  }

  const levelCache = new Map<string, number>();

  const resolveLevel = (stepId: string, trail: Set<string> = new Set()): number => {
    if (levelCache.has(stepId)) {
      return levelCache.get(stepId) ?? 0;
    }
    if (trail.has(stepId)) {
      return 0;
    }
    trail.add(stepId);
    const deps = depends.get(stepId) ?? [];
    if (deps.length === 0) {
      levelCache.set(stepId, 0);
      return 0;
    }
    const nextLevel = Math.max(
      0,
      ...deps.map((dep) => resolveLevel(dep, new Set(trail)))
    ) + 1;
    levelCache.set(stepId, nextLevel);
    return nextLevel;
  };

  const runStepById = new Map<string, WorkflowRunStep>();
  const fanoutChildrenByParent = new Map<string, PositionedFanOutChild[]>();
  for (const step of runSteps) {
    runStepById.set(step.stepId, step);
    if (step.parentStepId) {
      const child: PositionedFanOutChild = {
        ...step,
        durationMs: computeDurationMs(step.startedAt, step.completedAt, step.metrics)
      };
      const existing = fanoutChildrenByParent.get(step.parentStepId) ?? [];
      existing.push(child);
      fanoutChildrenByParent.set(step.parentStepId, existing);
    }
  }

  for (const children of fanoutChildrenByParent.values()) {
    children.sort(compareFanoutChildren);
  }

  return workflow.steps.map((step, index) => {
    const level = resolveLevel(step.id);
    const runStep = runStepById.get(step.id);
    const contextStatus = extractStatusFromContext(run, step.id);
    const contextStep = extractContextStep(run, step.id);
    const status = runStep?.status ?? contextStatus ?? 'pending';
    const startedAt = runStep?.startedAt ?? extractTimestamp(contextStep?.startedAt);
    const completedAt = runStep?.completedAt ?? extractTimestamp(contextStep?.completedAt);
    const durationMs = computeDurationMs(
      runStep?.startedAt ?? startedAt ?? null,
      runStep?.completedAt ?? completedAt ?? null,
      runStep?.metrics
    );

    let type: PositionedStep['type'] = 'unknown';
    if (step.type === 'fanout') {
      type = 'fanout';
    } else if (step.type === 'service' || step.serviceSlug) {
      type = 'service';
    } else if (step.type === 'job' || step.jobSlug) {
      type = 'job';
    }

    let fanout: PositionedStep['fanout'];
    if (type === 'fanout') {
      const children = fanoutChildrenByParent.get(step.id) ?? [];
      const counts = new Map<string, number>();
      for (const child of children) {
        const statusKey = (child.status ?? 'unknown').toLowerCase();
        counts.set(statusKey, (counts.get(statusKey) ?? 0) + 1);
      }
      fanout = {
        templateId: step.template?.id ?? null,
        templateName: step.template?.name ?? null,
        templateType: step.template?.type ?? (step.template?.serviceSlug ? 'service' : step.template?.jobSlug ? 'job' : 'unknown'),
        templateJobSlug: step.template?.jobSlug,
        templateServiceSlug: step.template?.serviceSlug,
        collection: step.collection,
        maxItems: typeof step.maxItems === 'number' ? step.maxItems : null,
        maxConcurrency: typeof step.maxConcurrency === 'number' ? step.maxConcurrency : null,
        storeResultsAs: step.storeResultsAs,
        totalChildren: children.length,
        statusCounts: sortStatusCounts(Array.from(counts.entries())),
        children
      } satisfies PositionedFanOut;
    }

    return {
      id: step.id,
      name: step.name,
      level,
      order: index,
      jobSlug: step.jobSlug,
      serviceSlug: step.serviceSlug,
      type,
      status,
      startedAt: startedAt ?? null,
      completedAt: completedAt ?? null,
      durationMs,
      logsUrl: runStep?.logsUrl ?? null,
      errorMessage: runStep?.errorMessage ?? null,
      metrics: runStep?.metrics,
      attempt: runStep?.attempt ?? null,
      jobRunId: runStep?.jobRunId ?? null,
      parameters: coalesce(runStep?.parameters, contextStep?.parameters, contextStep?.input, contextStep?.request),
      result: coalesce(runStep?.result, contextStep?.result, contextStep?.output, contextStep?.response),
      context: contextStep,
      dependsOn: depends.get(step.id) ?? [],
      fanout
    } satisfies PositionedStep;
  });
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 140;
const HORIZONTAL_GAP = 120;
const VERTICAL_GAP = 60;

export function WorkflowGraph({ workflow, run, steps, runtimeSummary }: WorkflowGraphProps) {
  const positioned = useMemo(() => buildPositionedSteps(workflow, run, steps), [workflow, run, steps]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedStepId) {
      return;
    }
    const stillExists = positioned.some((step) => step.id === selectedStepId);
    if (!stillExists) {
      setSelectedStepId(null);
    }
  }, [positioned, selectedStepId]);

  const levels = useMemo(() => {
    const grouped = new Map<number, PositionedStep[]>();
    for (const step of positioned) {
      const group = grouped.get(step.level) ?? [];
      group.push(step);
      grouped.set(step.level, group);
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => a.order - b.order);
    }
    return grouped;
  }, [positioned]);

  const levelCount = levels.size;
  const maxNodesPerLevel = Math.max(1, ...Array.from(levels.values(), (group) => group.length));
  const svgWidth = levelCount * NODE_WIDTH + Math.max(0, levelCount - 1) * HORIZONTAL_GAP;
  const svgHeight = maxNodesPerLevel * NODE_HEIGHT + Math.max(0, maxNodesPerLevel - 1) * VERTICAL_GAP;

  const nodesWithPosition = Array.from(levels.entries()).flatMap(([level, group]) =>
    group.map((node, index) => ({
      step: node,
      x: level * (NODE_WIDTH + HORIZONTAL_GAP),
      y: index * (NODE_HEIGHT + VERTICAL_GAP)
    }))
  );

  const nodePositionById = new Map<string, { x: number; y: number; step: PositionedStep }>();
  for (const entry of nodesWithPosition) {
    nodePositionById.set(entry.step.id, entry);
  }

  const edges: Edge[] = [];
  for (const node of positioned) {
    for (const dep of node.dependsOn) {
      const from = nodePositionById.get(dep)?.step;
      const to = nodePositionById.get(node.id)?.step;
      if (from && to) {
        edges.push({ from, to });
      }
    }
  }

  const selectedStep = selectedStepId ? nodePositionById.get(selectedStepId)?.step ?? null : null;
  const selectedInput = selectedStep
    ? coalesce(
        selectedStep.parameters,
        selectedStep.context?.parameters,
        selectedStep.context?.input,
        selectedStep.context?.request
      )
    : null;
  const selectedOutput = selectedStep
    ? coalesce(
        selectedStep.result,
        selectedStep.context?.result,
        selectedStep.context?.output,
        selectedStep.context?.response
      )
    : null;
  const formattedInput = formatStructuredValue(selectedInput);
  const formattedOutput = formatStructuredValue(selectedOutput);
  const formattedMetrics = formatStructuredValue(selectedStep?.metrics);
  const selectedFanout = selectedStep?.type === 'fanout' ? selectedStep.fanout : undefined;
  const fanoutStatusCounts = selectedFanout?.statusCounts ?? [];
  const fanoutChildren = selectedFanout?.children ?? [];
  const fanoutChildrenPreview = fanoutChildren.slice(0, FANOUT_CHILD_PREVIEW_LIMIT);
  const fanoutChildrenOverflow = fanoutChildren.length > fanoutChildrenPreview.length;

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow DAG</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Dependencies, current statuses, and timing information for the selected workflow.
        </p>
        {runtimeSummary?.status && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Latest run status: <span className="font-semibold text-slate-700 dark:text-slate-200">{runtimeSummary.status}</span>
          </p>
        )}
      </div>
      {workflow.steps.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">This workflow has no steps defined yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <div
            className="relative"
            style={{ minWidth: svgWidth, minHeight: svgHeight }}
            aria-label="Workflow graph"
          >
            <svg
              width={svgWidth}
              height={svgHeight}
              className="absolute left-0 top-0 h-full w-full"
              role="img"
              aria-hidden="true"
            >
              {edges.map((edge, index) => {
                const from = nodePositionById.get(edge.from.id);
                const to = nodePositionById.get(edge.to.id);
                if (!from || !to) {
                  return null;
                }
                const startX = from.x + NODE_WIDTH;
                const startY = from.y + NODE_HEIGHT / 2;
                const endX = to.x;
                const endY = to.y + NODE_HEIGHT / 2;
                const controlOffset = HORIZONTAL_GAP / 2;
                const path = `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
                return (
                  <path
                    key={`${edge.from.id}-${edge.to.id}-${index}`}
                    d={path}
                    stroke="#94a3b8"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="4 4"
                  />
                );
              })}
            </svg>
            <div className="relative">
              {nodesWithPosition.map(({ step, x, y }) => (
                <article
                  key={step.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedStepId === step.id}
                  onClick={() => setSelectedStepId(step.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedStepId(step.id);
                    }
                  }}
                  className={`absolute flex w-[240px] flex-col gap-2 rounded-2xl border bg-white/90 p-4 text-xs shadow-lg shadow-slate-500/10 transition-colors focus:outline-none dark:bg-slate-900/80 ${
                    selectedStepId === step.id
                      ? 'border-violet-500 ring-2 ring-violet-200 dark:border-violet-400 dark:ring-violet-500/40'
                      : 'border-slate-200/60 dark:border-slate-700/60'
                  }`}
                  style={{ left: x, top: y }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.name}</h3>
                      <p className="text-[11px] uppercase tracking-widest text-slate-400">
                        {step.type === 'service'
                          ? 'Service'
                          : step.type === 'job'
                            ? 'Job'
                            : step.type === 'fanout'
                              ? 'Fan Out'
                              : 'Step'}
                      </p>
                    </div>
                    <StatusBadge status={step.status} />
                  </div>
                  {(step.jobSlug || step.serviceSlug) && (
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {step.jobSlug ?? step.serviceSlug}
                    </p>
                  )}
                  {step.type === 'fanout' && step.fanout?.templateName && (
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      Template: {step.fanout.templateName}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {step.type === 'fanout' ? (
                      <>
                        <div>
                          <dt className="font-semibold uppercase tracking-widest text-slate-400">Children</dt>
                          <dd>{step.fanout?.totalChildren ?? 0}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
                          <dd>{formatDuration(step.durationMs)}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt className="font-semibold uppercase tracking-widest text-slate-400">Started</dt>
                          <dd>{formatTimestamp(step.startedAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
                          <dd>{formatDuration(step.durationMs)}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {step.type === 'fanout' && step.fanout?.statusCounts.length ? (
                    <div className="flex flex-wrap gap-1">
                      {step.fanout.statusCounts.map(({ status, count }) => (
                        <span
                          key={`${step.id}-${status}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold capitalize ${getStatusBadgeClasses(status)}`}
                        >
                          <span>{count}</span>
                          <span>{status}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {step.logsUrl && (
                    <a
                      href={step.logsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
                    >
                      View logs
                    </a>
                  )}
                  {step.errorMessage && (
                    <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                      {step.errorMessage}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        data-testid="workflow-step-details"
        className="mt-6 rounded-2xl border border-slate-200/60 bg-white/70 p-5 text-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        {selectedStep ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{selectedStep.name}</h3>
                {(selectedStep.jobSlug || selectedStep.serviceSlug) && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedStep.jobSlug ?? selectedStep.serviceSlug}
                  </p>
                )}
              </div>
              <StatusBadge status={selectedStep.status} />
            </div>
            <dl className="grid gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
              <div>
                <dt className="font-semibold uppercase tracking-widest text-slate-400">Started</dt>
                <dd>{formatTimestamp(selectedStep.startedAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-widest text-slate-400">Completed</dt>
                <dd>{formatTimestamp(selectedStep.completedAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
                <dd>{formatDuration(selectedStep.durationMs)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-widest text-slate-400">Attempt</dt>
                <dd>{selectedStep.attempt ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-widest text-slate-400">Job run</dt>
                <dd>{selectedStep.jobRunId ?? '—'}</dd>
              </div>
            </dl>
            {selectedStep.logsUrl && (
              <a
                href={selectedStep.logsUrl}
                target="_blank"
                rel="noreferrer"
                className="w-fit text-xs font-semibold text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
              >
                Open logs
              </a>
            )}
            {selectedStep.errorMessage && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{selectedStep.errorMessage}</p>
            )}
            {selectedStep.type === 'fanout' && selectedFanout && (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-slate-200/50 bg-white/60 p-4 text-xs text-slate-600 dark:border-slate-700/50 dark:bg-slate-900/60 dark:text-slate-300">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="font-semibold uppercase tracking-widest text-[10px] text-slate-400">Children</p>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedFanout.totalChildren}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-widest text-[10px] text-slate-400">Template</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {selectedFanout.templateName ?? '—'}
                      </p>
                      {(selectedFanout.templateJobSlug || selectedFanout.templateServiceSlug) && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {selectedFanout.templateJobSlug ?? selectedFanout.templateServiceSlug}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-widest text-[10px] text-slate-400">Store results as</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {selectedFanout.storeResultsAs ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-widest text-[10px] text-slate-400">Fan-out limits</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {selectedFanout.maxItems ? `${selectedFanout.maxItems} max items` : 'No max items'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {selectedFanout.maxConcurrency ? `${selectedFanout.maxConcurrency} max concurrency` : 'Default concurrency'}
                      </p>
                    </div>
                  </div>
                  {fanoutStatusCounts.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {fanoutStatusCounts.map(({ status, count }) => (
                        <span
                          key={`fanout-summary-${status}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-semibold capitalize ${getStatusBadgeClasses(status)}`}
                        >
                          <span>{status}</span>
                          <span>{count}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Child runs</h4>
                  {fanoutChildren.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No child runs have been recorded yet.
                    </p>
                  ) : (
                    <>
                      <div className="max-h-64 overflow-auto rounded-2xl border border-slate-200/60 bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/70">
                        <ul className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                          {fanoutChildrenPreview.map((child) => {
                            const label = child.templateStepId ?? child.stepId;
                            const indexLabel =
                              typeof child.fanoutIndex === 'number' ? `Index #${child.fanoutIndex}` : 'Index unknown';
                            const statusLabel = child.status ?? 'unknown';
                            return (
                              <li key={child.id} className="flex items-start justify-between gap-3 p-3">
                                <div className="flex flex-col gap-1">
                                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{label}</p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {indexLabel} • Attempt {child.attempt}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Started {formatTimestamp(child.startedAt)}
                                    {child.completedAt ? ` · Completed ${formatTimestamp(child.completedAt)}` : ''}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Duration {formatDuration(child.durationMs)}
                                  </p>
                                  {child.errorMessage && (
                                    <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                                      {child.errorMessage}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-[2px] text-[10px] font-semibold capitalize ${getStatusBadgeClasses(statusLabel)}`}
                                  >
                                    {statusLabel}
                                  </span>
                                  {child.logsUrl && (
                                    <a
                                      href={child.logsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] font-semibold text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
                                    >
                                      Logs
                                    </a>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      {fanoutChildrenOverflow && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Showing first {fanoutChildrenPreview.length} of {fanoutChildren.length} child runs.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Input</h4>
              {formattedInput ? (
                <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900/90 p-3 text-[11px] text-slate-100">
                  {formattedInput}
                </pre>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Input was not captured for this step.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Output</h4>
              {formattedOutput ? (
                <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900/90 p-3 text-[11px] text-slate-100">
                  {formattedOutput}
                </pre>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">No output has been recorded for this step.</p>
              )}
            </div>
            {formattedMetrics && (
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Metrics</h4>
                <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900/90 p-3 text-[11px] text-slate-100">
                  {formattedMetrics}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Select a step to inspect its run details.
          </p>
        )}
      </div>
    </section>
  );
}

export default WorkflowGraph;
