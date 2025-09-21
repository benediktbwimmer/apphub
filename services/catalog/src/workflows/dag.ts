import { type WorkflowDagMetadata, type WorkflowStepDefinition } from '../db/types';

export type WorkflowDagValidationErrorReason =
  | 'duplicate_step'
  | 'missing_dependency'
  | 'cycle_detected';

export type WorkflowDagValidationErrorDetail = {
  message: string;
  stepId?: string;
  dependencyId?: string;
  cycle?: string[];
};

export class WorkflowDagValidationError extends Error {
  readonly reason: WorkflowDagValidationErrorReason;
  readonly detail: WorkflowDagValidationErrorDetail;

  constructor(reason: WorkflowDagValidationErrorReason, detail: WorkflowDagValidationErrorDetail) {
    super(detail.message);
    this.name = 'WorkflowDagValidationError';
    this.reason = reason;
    this.detail = detail;
  }
}

type StepInfo = {
  id: string;
  dependsOn: string[];
};

function normalizeStep(step: WorkflowStepDefinition): StepInfo {
  const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn.filter(Boolean) : [];
  return {
    id: step.id,
    dependsOn: dependsOn.length > 0 ? Array.from(new Set(dependsOn)) : []
  };
}

function detectCycle(map: Map<string, StepInfo>): string[] | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  const dfs = (stepId: string): string[] | null => {
    visited.add(stepId);
    inStack.add(stepId);
    stack.push(stepId);

    const step = map.get(stepId);
    if (step) {
      for (const dependencyId of step.dependsOn) {
        if (!map.has(dependencyId)) {
          continue;
        }
        if (!visited.has(dependencyId)) {
          const cycle = dfs(dependencyId);
          if (cycle) {
            return cycle;
          }
          continue;
        }
        if (inStack.has(dependencyId)) {
          const cycleStart = stack.indexOf(dependencyId);
          if (cycleStart >= 0) {
            return [...stack.slice(cycleStart), dependencyId];
          }
          return [dependencyId, stepId, dependencyId];
        }
      }
    }

    stack.pop();
    inStack.delete(stepId);
    return null;
  };

  for (const stepId of map.keys()) {
    if (!visited.has(stepId)) {
      const cycle = dfs(stepId);
      if (cycle) {
        return cycle;
      }
    }
  }
  return null;
}

export function buildWorkflowDagMetadata(steps: WorkflowStepDefinition[]): WorkflowDagMetadata {
  if (steps.length === 0) {
    return { adjacency: {}, roots: [], topologicalOrder: [], edges: 0 };
  }

  const infos = steps.map((step) => normalizeStep(step));
  const idSet = new Set<string>();
  const infoById = new Map<string, StepInfo>();

  for (const info of infos) {
    if (idSet.has(info.id)) {
      throw new WorkflowDagValidationError('duplicate_step', {
        message: `Duplicate step id "${info.id}" detected in workflow definition`,
        stepId: info.id
      });
    }
    idSet.add(info.id);
    infoById.set(info.id, info);
  }

  for (const info of infos) {
    for (const dependencyId of info.dependsOn) {
      if (!infoById.has(dependencyId)) {
        throw new WorkflowDagValidationError('missing_dependency', {
          message: `Step "${info.id}" references missing dependency "${dependencyId}"`,
          stepId: info.id,
          dependencyId
        });
      }
    }
  }

  const cycle = detectCycle(infoById);
  if (cycle) {
    throw new WorkflowDagValidationError('cycle_detected', {
      message: `Workflow definition contains a cycle: ${cycle.join(' -> ')}`,
      cycle
    });
  }

  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  let edgeCount = 0;

  for (const info of infos) {
    inDegree.set(info.id, info.dependsOn.length);
    if (!adjacency.has(info.id)) {
      adjacency.set(info.id, new Set<string>());
    }
  }

  for (const info of infos) {
    for (const dependencyId of info.dependsOn) {
      adjacency.get(dependencyId)?.add(info.id);
      edgeCount += 1;
    }
  }

  const queue: string[] = [];
  for (const [stepId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(stepId);
    }
  }

  const order: string[] = [];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    order.push(current);
    for (const dependent of adjacency.get(current) ?? []) {
      const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (order.length !== infos.length) {
    throw new WorkflowDagValidationError('cycle_detected', {
      message: 'Workflow definition contains a cycle that prevented topological ordering'
    });
  }

  const roots = order.filter((stepId) => (infoById.get(stepId)?.dependsOn.length ?? 0) === 0);
  const adjacencyRecord: Record<string, string[]> = {};
  for (const [stepId, dependents] of adjacency.entries()) {
    adjacencyRecord[stepId] = Array.from(dependents);
  }

  return {
    adjacency: adjacencyRecord,
    roots,
    topologicalOrder: order,
    edges: edgeCount
  } satisfies WorkflowDagMetadata;
}

export function applyDagMetadataToSteps(
  steps: WorkflowStepDefinition[],
  dag: WorkflowDagMetadata
): WorkflowStepDefinition[] {
  const adjacency = dag.adjacency;
  return steps.map((step) => {
    const dependents = adjacency[step.id] ?? [];
    if (dependents.length === 0 && step.dependsOn === undefined) {
      return step;
    }
    return {
      ...step,
      dependents: dependents.length > 0 ? dependents : undefined
    } satisfies WorkflowStepDefinition;
  });
}
