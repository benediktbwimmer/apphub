import { useMemo } from 'react';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep, WorkflowRuntimeSummary } from '../types';
import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';

type WorkflowGraphProps = {
  workflow: WorkflowDefinition;
  run: WorkflowRun | null;
  steps: WorkflowRunStep[];
  runtimeSummary?: WorkflowRuntimeSummary;
};

type PositionedStep = {
  id: string;
  name: string;
  level: number;
  order: number;
  jobSlug?: string;
  serviceSlug?: string;
  type: 'job' | 'service' | 'unknown';
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  logsUrl: string | null;
  errorMessage?: string | null;
  metrics?: unknown;
  dependsOn: string[];
};

type Edge = {
  from: PositionedStep;
  to: PositionedStep;
};

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
  for (const step of runSteps) {
    runStepById.set(step.stepId, step);
  }

  return workflow.steps.map((step, index) => {
    const level = resolveLevel(step.id);
    const runStep = runStepById.get(step.id);
    const contextStatus = extractStatusFromContext(run, step.id);
    const contextStep = extractContextStep(run, step.id);
    const status = runStep?.status ?? contextStatus ?? 'pending';
    const startedAt = runStep?.startedAt ?? extractTimestamp(contextStep?.startedAt);
    const completedAt = runStep?.completedAt ?? extractTimestamp(contextStep?.completedAt);
    let durationMs: number | null = runStep?.metrics && typeof runStep.metrics === 'object' && runStep.metrics !== null
      ? extractNumber((runStep.metrics as Record<string, unknown>).durationMs)
      : null;
    if (!durationMs && startedAt && completedAt) {
      const start = Date.parse(startedAt);
      const end = Date.parse(completedAt);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
        durationMs = end - start;
      }
    }

    const type: PositionedStep['type'] = step.serviceSlug
      ? 'service'
      : step.jobSlug
        ? 'job'
        : 'unknown';

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
      dependsOn: depends.get(step.id) ?? []
    } satisfies PositionedStep;
  });
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 140;
const HORIZONTAL_GAP = 120;
const VERTICAL_GAP = 60;

export function WorkflowGraph({ workflow, run, steps, runtimeSummary }: WorkflowGraphProps) {
  const positioned = useMemo(() => buildPositionedSteps(workflow, run, steps), [workflow, run, steps]);

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
                  className="absolute flex w-[240px] flex-col gap-2 rounded-2xl border border-slate-200/60 bg-white/90 p-4 text-xs shadow-lg shadow-slate-500/10 transition-colors dark:border-slate-700/60 dark:bg-slate-900/80"
                  style={{ left: x, top: y }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.name}</h3>
                      <p className="text-[11px] uppercase tracking-widest text-slate-400">
                        {step.type === 'service' ? 'Service' : step.type === 'job' ? 'Job' : 'Step'}
                      </p>
                    </div>
                    <StatusBadge status={step.status} />
                  </div>
                  {(step.jobSlug || step.serviceSlug) && (
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {step.jobSlug ?? step.serviceSlug}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <div>
                      <dt className="font-semibold uppercase tracking-widest text-slate-400">Started</dt>
                      <dd>{formatTimestamp(step.startedAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
                      <dd>{formatDuration(step.durationMs)}</dd>
                    </div>
                  </dl>
                  {step.logsUrl && (
                    <a
                      href={step.logsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-300"
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
    </section>
  );
}

export default WorkflowGraph;
