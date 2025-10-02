import type {
  WorkflowDagMetadata,
  WorkflowStepDefinition,
  WorkflowJobStepDefinition,
  WorkflowServiceStepDefinition,
  WorkflowFanOutStepDefinition
} from '../db/types';
import { buildWorkflowDagMetadata } from './dag';

const STEP_REFERENCE_PATTERN = /steps\.([A-Za-z0-9_-]+)/g;

function cloneWorkflowStep(step: WorkflowStepDefinition): WorkflowStepDefinition {
  return JSON.parse(JSON.stringify(step)) as WorkflowStepDefinition;
}

function collectStepReferenceIds(value: unknown, accumulator: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(STEP_REFERENCE_PATTERN)) {
      const stepId = match[1]?.trim();
      if (stepId) {
        accumulator.add(stepId);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStepReferenceIds(entry, accumulator);
    }
    return;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const entry of Object.values(record)) {
      collectStepReferenceIds(entry, accumulator);
    }
  }
}

function collectConsumesDependencies(
  step: WorkflowStepDefinition,
  assetProducers: Map<string, Set<string>>,
  accumulator: Set<string>
): void {
  if (!Array.isArray(step.consumes)) {
    return;
  }
  for (const declaration of step.consumes) {
    const assetId = typeof declaration.assetId === 'string' ? declaration.assetId.trim() : '';
    if (!assetId) {
      continue;
    }
    const producers = assetProducers.get(assetId);
    if (!producers) {
      continue;
    }
    for (const producer of producers) {
      if (producer !== step.id) {
        accumulator.add(producer);
      }
    }
  }
}

export function inferWorkflowStepDependencies(steps: WorkflowStepDefinition[]): WorkflowStepDefinition[] {
  if (steps.length === 0) {
    return steps;
  }

  const clonedSteps = steps.map((step) => cloneWorkflowStep(step));
  const stepIds = new Set(clonedSteps.map((step) => step.id));
  const assetProducers = new Map<string, Set<string>>();

  for (const step of clonedSteps) {
    if (!Array.isArray(step.produces)) {
      continue;
    }
    for (const declaration of step.produces) {
      const assetId = typeof declaration.assetId === 'string' ? declaration.assetId.trim() : '';
      if (!assetId) {
        continue;
      }
      if (!assetProducers.has(assetId)) {
        assetProducers.set(assetId, new Set());
      }
      assetProducers.get(assetId)?.add(step.id);
    }
  }

  return clonedSteps.map((step) => {
    const dependencies = new Set<string>((step.dependsOn ?? []).filter((id) => id && id !== step.id));

    const stepWithParams = step as WorkflowJobStepDefinition | WorkflowServiceStepDefinition;
    if ('parameters' in stepWithParams && stepWithParams.parameters !== undefined) {
      collectStepReferenceIds(stepWithParams.parameters, dependencies);
    }

    if (step.type === 'fanout') {
      const fanout = step as WorkflowFanOutStepDefinition;
      collectStepReferenceIds(fanout.collection, dependencies);
      collectStepReferenceIds(fanout.template, dependencies);
    }

    if (step.type === 'service') {
      const serviceStep = step as WorkflowServiceStepDefinition;
      collectStepReferenceIds(serviceStep.request, dependencies);
    }

    collectConsumesDependencies(step, assetProducers, dependencies);

    const normalizedDependencies = Array.from(dependencies).filter((candidate) => stepIds.has(candidate) && candidate !== step.id);
    normalizedDependencies.sort((a, b) => a.localeCompare(b));

    if (normalizedDependencies.length > 0) {
      step.dependsOn = normalizedDependencies;
    } else if (step.dependsOn) {
      delete step.dependsOn;
    }

    return step;
  });
}

export function deriveDagMetadata(
  steps: WorkflowStepDefinition[]
): { steps: WorkflowStepDefinition[]; dag: WorkflowDagMetadata } {
  const inferredSteps = inferWorkflowStepDependencies(steps);
  try {
    return { steps: inferredSteps, dag: buildWorkflowDagMetadata(inferredSteps) };
  } catch (error) {
    return {
      steps: inferredSteps,
      dag: {
        adjacency: {},
        roots: inferredSteps.map((step) => step.id),
        topologicalOrder: inferredSteps.map((step) => step.id),
        edges: 0
      }
    };
  }
}
