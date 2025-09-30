import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep, WorkflowRuntimeSummary } from '../types';
import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import { getStatusBadgeClasses } from './statusBadgeClasses';

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

const EDGE_STROKE_COLOR = 'var(--color-border-subtle)';

const GRAPH_SECTION_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const GRAPH_HEADER_CONTAINER_CLASSES = 'mb-4 flex flex-col gap-1';

const GRAPH_HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const GRAPH_HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-secondary';

const GRAPH_EMPTY_TEXT_CLASSES = 'text-scale-sm text-secondary';

const GRAPH_NODE_CARD_BASE_CLASSES =
  'absolute flex w-[240px] flex-col gap-2 rounded-2xl border bg-surface-glass p-4 text-scale-xs shadow-elevation-lg transition-colors hover:bg-surface-glass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const GRAPH_NODE_CARD_SELECTED_CLASSES = 'border-accent ring-2 ring-accent';

const GRAPH_NODE_CARD_UNSELECTED_CLASSES = 'border-subtle';

const GRAPH_NODE_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const GRAPH_NODE_TYPE_CLASSES = 'text-[11px] uppercase tracking-[0.34em] text-muted';

const GRAPH_NODE_META_TEXT_CLASSES = 'truncate text-[11px] text-muted';

const GRAPH_NODE_INFO_LIST_CLASSES = 'grid grid-cols-2 gap-1 text-[11px] text-muted';

const GRAPH_NODE_INFO_LABEL_CLASSES = 'font-weight-semibold uppercase tracking-widest text-muted';

const GRAPH_NODE_LOG_LINK_CLASSES =
  'text-[11px] font-weight-semibold text-accent underline-offset-2 transition-colors hover:text-accent-strong hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const GRAPH_NODE_ERROR_CLASSES = 'text-[11px] font-weight-semibold text-status-danger';

const STATUS_PILL_BASE_CLASSES =
  'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-weight-semibold capitalize';

const STEP_DETAILS_CONTAINER_CLASSES =
  'mt-6 rounded-2xl border border-subtle bg-surface-glass p-5 text-scale-sm transition-colors';

const STEP_DETAILS_HEADER_TITLE_CLASSES = 'text-scale-md font-weight-semibold text-primary';

const STEP_DETAILS_HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const STEP_DETAILS_INFO_GRID_CLASSES = 'grid gap-3 text-scale-xs text-secondary sm:grid-cols-2';

const STEP_DETAILS_INFO_LABEL_CLASSES = 'font-weight-semibold uppercase tracking-widest text-muted';

const STEP_DETAILS_LOG_LINK_CLASSES =
  'w-fit text-scale-xs font-weight-semibold text-accent underline-offset-2 transition-colors hover:text-accent-strong hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const STEP_DETAILS_ERROR_CLASSES = 'text-scale-xs font-weight-semibold text-status-danger';

const FANOUT_SUMMARY_CONTAINER_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-4 text-scale-xs text-secondary';

const FANOUT_SUMMARY_GRID_CLASSES = 'grid gap-3 sm:grid-cols-2';

const FANOUT_SUMMARY_LABEL_CLASSES = 'font-weight-semibold uppercase tracking-widest text-[10px] text-muted';

const FANOUT_SUMMARY_VALUE_PRIMARY_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const FANOUT_SUMMARY_VALUE_SECONDARY_CLASSES = 'text-scale-sm text-secondary';

const FANOUT_SUMMARY_NOTE_CLASSES = 'text-[11px] text-muted';

const FANOUT_CHILD_LIST_CONTAINER_CLASSES =
  'max-h-64 overflow-auto rounded-2xl border border-subtle bg-surface-glass';

const FANOUT_CHILD_LIST_CLASSES = 'divide-y divide-subtle text-scale-xs';

const FANOUT_CHILD_ITEM_CLASSES = 'flex items-start justify-between gap-3 p-3';

const FANOUT_CHILD_ITEM_TITLE_CLASSES = 'text-scale-xs font-weight-semibold text-primary';

const FANOUT_CHILD_ITEM_META_CLASSES = 'text-[11px] text-muted';

const FANOUT_CHILD_ERROR_CLASSES = 'text-[11px] font-weight-semibold text-status-danger';

const FANOUT_CHILD_LINK_CLASSES =
  'text-[11px] font-weight-semibold text-accent underline-offset-2 transition-colors hover:text-accent-strong hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const JSON_SECTION_TITLE_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-widest text-muted';

const JSON_SECTION_CODE_CLASSES =
  'max-h-60 overflow-auto rounded-xl bg-surface-sunken px-3 py-2 font-mono text-[11px] text-primary';

const JSON_SECTION_EMPTY_TEXT_CLASSES = 'text-scale-xs text-muted';

const STEP_PROMPT_TEXT_CLASSES = 'text-scale-sm text-secondary';

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

function hasStructuredContent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  return true;
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
  const metricsValue = selectedStep?.metrics ?? null;
  const hasInput = hasStructuredContent(selectedInput);
  const hasOutput = hasStructuredContent(selectedOutput);
  const hasMetrics = hasStructuredContent(metricsValue);
  const selectedFanout = selectedStep?.type === 'fanout' ? selectedStep.fanout : undefined;
  const fanoutStatusCounts = selectedFanout?.statusCounts ?? [];
  const fanoutChildren = selectedFanout?.children ?? [];
  const fanoutChildrenPreview = fanoutChildren.slice(0, FANOUT_CHILD_PREVIEW_LIMIT);
  const fanoutChildrenOverflow = fanoutChildren.length > fanoutChildrenPreview.length;

  return (
    <section className={GRAPH_SECTION_CLASSES}>
      <div className={GRAPH_HEADER_CONTAINER_CLASSES}>
        <h2 className={GRAPH_HEADER_TITLE_CLASSES}>Workflow DAG</h2>
        <p className={GRAPH_HEADER_SUBTEXT_CLASSES}>
          Dependencies, current statuses, and timing information for the selected workflow.
        </p>
        {runtimeSummary?.status && (
          <p className={GRAPH_HEADER_SUBTEXT_CLASSES}>
            Latest run status: <span className="font-weight-semibold text-primary">{runtimeSummary.status}</span>
          </p>
        )}
      </div>
      {workflow.steps.length === 0 ? (
        <p className={GRAPH_EMPTY_TEXT_CLASSES}>This workflow has no steps defined yet.</p>
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
                    stroke={EDGE_STROKE_COLOR}
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
                  className={classNames(
                    GRAPH_NODE_CARD_BASE_CLASSES,
                    selectedStepId === step.id
                      ? GRAPH_NODE_CARD_SELECTED_CLASSES
                      : GRAPH_NODE_CARD_UNSELECTED_CLASSES
                  )}
                  style={{ left: x, top: y }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className={GRAPH_NODE_TITLE_CLASSES}>{step.name}</h3>
                      <p className={GRAPH_NODE_TYPE_CLASSES}>
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
                    <p className={GRAPH_NODE_META_TEXT_CLASSES}>{step.jobSlug ?? step.serviceSlug}</p>
                  )}
                  {step.type === 'fanout' && step.fanout?.templateName && (
                    <p className={GRAPH_NODE_META_TEXT_CLASSES}>
                      Template: {step.fanout.templateName}
                    </p>
                  )}
                  <dl className={GRAPH_NODE_INFO_LIST_CLASSES}>
                    {step.type === 'fanout' ? (
                      <>
                        <div>
                          <dt className={GRAPH_NODE_INFO_LABEL_CLASSES}>Children</dt>
                          <dd>{step.fanout?.totalChildren ?? 0}</dd>
                        </div>
                        <div>
                          <dt className={GRAPH_NODE_INFO_LABEL_CLASSES}>Duration</dt>
                          <dd>{formatDuration(step.durationMs)}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt className={GRAPH_NODE_INFO_LABEL_CLASSES}>Started</dt>
                          <dd>{formatTimestamp(step.startedAt)}</dd>
                        </div>
                        <div>
                          <dt className={GRAPH_NODE_INFO_LABEL_CLASSES}>Duration</dt>
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
                          className={classNames(STATUS_PILL_BASE_CLASSES, getStatusBadgeClasses(status))}
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
                      className={GRAPH_NODE_LOG_LINK_CLASSES}
                    >
                      View logs
                    </a>
                  )}
                  {step.errorMessage && (
                    <p className={GRAPH_NODE_ERROR_CLASSES}>
                      {step.errorMessage}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
      <div data-testid="workflow-step-details" className={STEP_DETAILS_CONTAINER_CLASSES}>
        {selectedStep ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className={STEP_DETAILS_HEADER_TITLE_CLASSES}>{selectedStep.name}</h3>
                {(selectedStep.jobSlug || selectedStep.serviceSlug) && (
                  <p className={STEP_DETAILS_HEADER_SUBTEXT_CLASSES}>
                    {selectedStep.jobSlug ?? selectedStep.serviceSlug}
                  </p>
                )}
              </div>
              <StatusBadge status={selectedStep.status} />
            </div>
            <dl className={STEP_DETAILS_INFO_GRID_CLASSES}>
              <div>
                <dt className={STEP_DETAILS_INFO_LABEL_CLASSES}>Started</dt>
                <dd>{formatTimestamp(selectedStep.startedAt)}</dd>
              </div>
              <div>
                <dt className={STEP_DETAILS_INFO_LABEL_CLASSES}>Completed</dt>
                <dd>{formatTimestamp(selectedStep.completedAt)}</dd>
              </div>
              <div>
                <dt className={STEP_DETAILS_INFO_LABEL_CLASSES}>Duration</dt>
                <dd>{formatDuration(selectedStep.durationMs)}</dd>
              </div>
              <div>
                <dt className={STEP_DETAILS_INFO_LABEL_CLASSES}>Attempt</dt>
                <dd>{selectedStep.attempt ?? '—'}</dd>
              </div>
              <div>
                <dt className={STEP_DETAILS_INFO_LABEL_CLASSES}>Job run</dt>
                <dd>{selectedStep.jobRunId ?? '—'}</dd>
              </div>
            </dl>
            {selectedStep.logsUrl && (
              <a
                href={selectedStep.logsUrl}
                target="_blank"
                rel="noreferrer"
                className={STEP_DETAILS_LOG_LINK_CLASSES}
              >
                Open logs
              </a>
            )}
            {selectedStep.errorMessage && (
              <p className={STEP_DETAILS_ERROR_CLASSES}>{selectedStep.errorMessage}</p>
            )}
            {selectedStep.type === 'fanout' && selectedFanout && (
              <div className="flex flex-col gap-3">
                <div className={FANOUT_SUMMARY_CONTAINER_CLASSES}>
                  <div className={FANOUT_SUMMARY_GRID_CLASSES}>
                    <div>
                      <p className={FANOUT_SUMMARY_LABEL_CLASSES}>Children</p>
                      <p className={FANOUT_SUMMARY_VALUE_PRIMARY_CLASSES}>
                        {selectedFanout.totalChildren}
                      </p>
                    </div>
                    <div>
                      <p className={FANOUT_SUMMARY_LABEL_CLASSES}>Template</p>
                      <p className={FANOUT_SUMMARY_VALUE_SECONDARY_CLASSES}>
                        {selectedFanout.templateName ?? '—'}
                      </p>
                      {(selectedFanout.templateJobSlug || selectedFanout.templateServiceSlug) && (
                        <p className={FANOUT_SUMMARY_NOTE_CLASSES}>
                          {selectedFanout.templateJobSlug ?? selectedFanout.templateServiceSlug}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className={FANOUT_SUMMARY_LABEL_CLASSES}>Store results as</p>
                      <p className={FANOUT_SUMMARY_VALUE_SECONDARY_CLASSES}>
                        {selectedFanout.storeResultsAs ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className={FANOUT_SUMMARY_LABEL_CLASSES}>Fan-out limits</p>
                      <p className={FANOUT_SUMMARY_VALUE_SECONDARY_CLASSES}>
                        {selectedFanout.maxItems ? `${selectedFanout.maxItems} max items` : 'No max items'}
                      </p>
                      <p className={FANOUT_SUMMARY_NOTE_CLASSES}>
                        {selectedFanout.maxConcurrency ? `${selectedFanout.maxConcurrency} max concurrency` : 'Default concurrency'}
                      </p>
                    </div>
                  </div>
                  {fanoutStatusCounts.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {fanoutStatusCounts.map(({ status, count }) => (
                        <span
                          key={`fanout-summary-${status}`}
                          className={classNames(STATUS_PILL_BASE_CLASSES, 'px-3', getStatusBadgeClasses(status))}
                        >
                          <span>{status}</span>
                          <span>{count}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className={JSON_SECTION_TITLE_CLASSES}>Child runs</h4>
                  {fanoutChildren.length === 0 ? (
                    <p className={JSON_SECTION_EMPTY_TEXT_CLASSES}>No child runs have been recorded yet.</p>
                  ) : (
                    <>
                      <div className={FANOUT_CHILD_LIST_CONTAINER_CLASSES}>
                        <ul className={FANOUT_CHILD_LIST_CLASSES}>
                          {fanoutChildrenPreview.map((child) => {
                            const label = child.templateStepId ?? child.stepId;
                            const indexLabel =
                              typeof child.fanoutIndex === 'number' ? `Index #${child.fanoutIndex}` : 'Index unknown';
                            const statusLabel = child.status ?? 'unknown';
                            return (
                              <li key={child.id} className={FANOUT_CHILD_ITEM_CLASSES}>
                                <div className="flex flex-col gap-1">
                                  <p className={FANOUT_CHILD_ITEM_TITLE_CLASSES}>{label}</p>
                                  <p className={FANOUT_CHILD_ITEM_META_CLASSES}>
                                    {indexLabel} • Attempt {child.attempt}
                                  </p>
                                  <p className={FANOUT_CHILD_ITEM_META_CLASSES}>
                                    Started {formatTimestamp(child.startedAt)}
                                    {child.completedAt ? ` · Completed ${formatTimestamp(child.completedAt)}` : ''}
                                  </p>
                                  <p className={FANOUT_CHILD_ITEM_META_CLASSES}>
                                    Duration {formatDuration(child.durationMs)}
                                  </p>
                                  {child.errorMessage && (
                                    <p className={FANOUT_CHILD_ERROR_CLASSES}>{child.errorMessage}</p>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  <span
                                    className={classNames(STATUS_PILL_BASE_CLASSES, getStatusBadgeClasses(statusLabel))}
                                  >
                                    {statusLabel}
                                  </span>
                                  {child.logsUrl && (
                                    <a
                                      href={child.logsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={FANOUT_CHILD_LINK_CLASSES}
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
                        <p className={FANOUT_SUMMARY_NOTE_CLASSES}>
                          Showing first {fanoutChildrenPreview.length} of {fanoutChildren.length} child runs.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <h4 className={JSON_SECTION_TITLE_CLASSES}>Input</h4>
              {hasInput ? (
                <JsonSyntaxHighlighter value={selectedInput} className={JSON_SECTION_CODE_CLASSES} />
              ) : (
                <p className={JSON_SECTION_EMPTY_TEXT_CLASSES}>Input was not captured for this step.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h4 className={JSON_SECTION_TITLE_CLASSES}>Output</h4>
              {hasOutput ? (
                <JsonSyntaxHighlighter value={selectedOutput} className={JSON_SECTION_CODE_CLASSES} />
              ) : (
                <p className={JSON_SECTION_EMPTY_TEXT_CLASSES}>No output has been recorded for this step.</p>
              )}
            </div>
            {hasMetrics && (
              <div className="flex flex-col gap-2">
                <h4 className={JSON_SECTION_TITLE_CLASSES}>Metrics</h4>
                <JsonSyntaxHighlighter value={metricsValue} className={JSON_SECTION_CODE_CLASSES} />
              </div>
            )}
          </div>
        ) : (
          <p className={STEP_PROMPT_TEXT_CLASSES}>Select a step to inspect its run details.</p>
        )}
      </div>
    </section>
  );
}

export default WorkflowGraph;
