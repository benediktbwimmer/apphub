import { parseBundleEntryPoint } from '../../jobs/bundleBinding';
import { getJobDefinitionsBySlugs } from '../../db/index';
import type {
  JobDefinitionRecord,
  WorkflowAssetDeclaration,
  WorkflowFanOutTemplateDefinition,
  WorkflowJobStepBundle,
  WorkflowJobStepDefinition,
  WorkflowStepDefinition
} from '../../db/types';
import {
  type WorkflowFanOutTemplateInput,
  type WorkflowStepInput,
  type WorkflowTriggerInput,
  type WorkflowAssetDeclarationInput
} from '../../workflows/zodSchemas';
import type { JsonValue } from '../../db/types';

export type WorkflowJobStepInput = Extract<WorkflowStepInput, { jobSlug: string }>;
export type WorkflowJobTemplateInput = Extract<WorkflowFanOutTemplateInput, { jobSlug: string }>;
export type JobDefinitionLookup = Map<string, JobDefinitionRecord>;

export function normalizeAssetPartitioning(
  partitioning: WorkflowAssetDeclarationInput['partitioning']
): WorkflowAssetDeclaration['partitioning'] | undefined {
  if (!partitioning) {
    return undefined;
  }

  if (partitioning.type === 'static') {
    const keys = Array.from(
      new Set(partitioning.keys.map((key) => key.trim()).filter((key) => key.length > 0))
    );
    if (keys.length === 0) {
      return undefined;
    }
    return {
      type: 'static',
      keys
    } satisfies WorkflowAssetDeclaration['partitioning'];
  }

  if (partitioning.type === 'timeWindow') {
    const timezone = partitioning.timezone?.trim();
    const format = partitioning.format?.trim();
    const normalized: WorkflowAssetDeclaration['partitioning'] = {
      type: 'timeWindow',
      granularity: partitioning.granularity,
      timezone: timezone && timezone.length > 0 ? timezone : undefined,
      format: format && format.length > 0 ? format : undefined,
      lookbackWindows:
        typeof partitioning.lookbackWindows === 'number'
          ? Math.max(1, Math.floor(partitioning.lookbackWindows))
          : undefined
    };
    return normalized;
  }

  if (partitioning.type === 'dynamic') {
    const normalized: WorkflowAssetDeclaration['partitioning'] = { type: 'dynamic' };
    if (typeof partitioning.maxKeys === 'number') {
      normalized.maxKeys = Math.max(1, Math.floor(partitioning.maxKeys));
    }
    if (typeof partitioning.retentionDays === 'number') {
      normalized.retentionDays = Math.max(1, Math.floor(partitioning.retentionDays));
    }
    return normalized;
  }

  return undefined;
}

export function normalizeAssetDeclarations(
  declarations: WorkflowAssetDeclarationInput[] | undefined
): WorkflowAssetDeclaration[] | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  const normalized: WorkflowAssetDeclaration[] = [];
  const seen = new Set<string>();

  for (const declaration of declarations) {
    const assetId = declaration.assetId.trim();
    if (!assetId) {
      continue;
    }
    const key = assetId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const entry: WorkflowAssetDeclaration = { assetId };

    if (declaration.schema) {
      entry.schema = declaration.schema;
    }
    if (declaration.freshness) {
      entry.freshness = declaration.freshness;
    }
    if (declaration.autoMaterialize) {
      entry.autoMaterialize = declaration.autoMaterialize;
    }

    const partitioning = normalizeAssetPartitioning(declaration.partitioning);
    if (partitioning) {
      entry.partitioning = partitioning;
    }

    normalized.push(entry);
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeWorkflowDependsOn(dependsOn?: string[]) {
  if (!dependsOn) {
    return undefined;
  }
  const unique = Array.from(new Set(dependsOn.map((id) => id.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

export function collectWorkflowJobSlugs(steps: WorkflowStepInput[]): string[] {
  const slugs = new Set<string>();
  for (const step of steps) {
    if (step.type === 'service') {
      continue;
    }
    if (step.type === 'fanout') {
      const template = step.template;
      if (template.type !== 'service' && typeof template.jobSlug === 'string') {
        const slug = template.jobSlug.trim().toLowerCase();
        if (slug) {
          slugs.add(slug);
        }
      }
      continue;
    }
    if (typeof step.jobSlug === 'string') {
      const slug = step.jobSlug.trim().toLowerCase();
      if (slug) {
        slugs.add(slug);
      }
    }
  }
  return Array.from(slugs);
}

export function lookupJobDefinition(jobDefinitions: JobDefinitionLookup, slug: string | undefined) {
  if (!slug) {
    return undefined;
  }
  return jobDefinitions.get(slug.trim().toLowerCase());
}

export function normalizeJobBundle(
  rawBundle: WorkflowJobStepInput['bundle'] | null | undefined,
  jobDefinition: JobDefinitionRecord | undefined
): WorkflowJobStepBundle | null | undefined {
  if (rawBundle === null) {
    return null;
  }
  const parsed = jobDefinition ? parseBundleEntryPoint(jobDefinition.entryPoint) : null;

  if (rawBundle && rawBundle.strategy === 'latest') {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'latest',
            slug: parsed.slug,
            version: null,
            exportName: parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'latest',
      slug,
      version: null,
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (rawBundle && typeof rawBundle.version === 'string' && rawBundle.version.trim().length > 0) {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'pinned',
            slug: parsed.slug,
            version: rawBundle.version.trim(),
            exportName: rawBundle.exportName ?? parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'pinned',
      slug,
      version: rawBundle.version.trim(),
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (parsed) {
    return {
      strategy: 'pinned',
      slug: parsed.slug,
      version: parsed.version,
      exportName: parsed.exportName ?? null
    } satisfies WorkflowJobStepBundle;
  }

  return undefined;
}

export function buildWorkflowStepMetadata(steps: WorkflowStepDefinition[]) {
  const metadata = new Map<
    string,
    {
      name: string;
      type: WorkflowStepDefinition['type'];
    }
  >();

  for (const step of steps) {
    metadata.set(step.id, {
      name: step.name ?? step.id,
      type: step.type
    });

    if (step.type === 'fanout') {
      const template = step.template;
      metadata.set(template.id, {
        name: template.name ?? template.id,
        type: template.type
      });
    }
  }

  return metadata;
}

export function normalizeWorkflowJobStep(
  step: WorkflowJobStepInput,
  jobDefinitions: JobDefinitionLookup
): WorkflowJobStepDefinition {
  const jobDefinition = lookupJobDefinition(jobDefinitions, step.jobSlug);
  const bundle = normalizeJobBundle(step.bundle ?? undefined, jobDefinition);
  const produces = normalizeAssetDeclarations(step.produces);
  const consumes = normalizeAssetDeclarations(step.consumes);

  const base = {
    id: step.id,
    name: step.name,
    description: step.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(step.dependsOn)
  } satisfies Pick<WorkflowJobStepDefinition, 'id' | 'name' | 'description' | 'dependsOn'>;

  const normalized: WorkflowJobStepDefinition = {
    ...base,
    type: 'job',
    jobSlug: step.jobSlug,
    parameters: step.parameters ?? undefined,
    timeoutMs: step.timeoutMs ?? null,
    retryPolicy: step.retryPolicy ?? null,
    storeResultAs: step.storeResultAs ?? undefined
  } satisfies WorkflowJobStepDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }
  if (produces) {
    normalized.produces = produces;
  }
  if (consumes) {
    normalized.consumes = consumes;
  }

  return normalized;
}

export function normalizeWorkflowFanOutTemplate(
  template: WorkflowFanOutTemplateInput,
  jobDefinitions: JobDefinitionLookup
): WorkflowFanOutTemplateDefinition {
  const base = {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(template.dependsOn)
  } satisfies Pick<WorkflowFanOutTemplateDefinition, 'id' | 'name' | 'description' | 'dependsOn'>;

  if (template.type === 'service') {
    const produces = normalizeAssetDeclarations(template.produces);
    const consumes = normalizeAssetDeclarations(template.consumes);

    const definition: WorkflowFanOutTemplateDefinition = {
      ...base,
      type: 'service',
      serviceSlug: template.serviceSlug.trim().toLowerCase(),
      parameters: template.parameters ?? undefined,
      timeoutMs: template.timeoutMs ?? null,
      retryPolicy: template.retryPolicy ?? null,
      requireHealthy: template.requireHealthy ?? undefined,
      allowDegraded: template.allowDegraded ?? undefined,
      captureResponse: template.captureResponse ?? undefined,
      storeResponseAs: template.storeResponseAs ?? undefined,
      request: template.request
    } satisfies WorkflowFanOutTemplateDefinition;

    if (produces) {
      definition.produces = produces;
    }
    if (consumes) {
      definition.consumes = consumes;
    }
    return definition;
  }

  const jobTemplate = template as WorkflowJobTemplateInput;
  const jobDefinition = lookupJobDefinition(jobDefinitions, jobTemplate.jobSlug);
  const bundle = normalizeJobBundle(jobTemplate.bundle ?? undefined, jobDefinition);
  const produces = normalizeAssetDeclarations(jobTemplate.produces);
  const consumes = normalizeAssetDeclarations(jobTemplate.consumes);

  const normalized: WorkflowFanOutTemplateDefinition = {
    ...base,
    type: 'job',
    jobSlug: jobTemplate.jobSlug,
    parameters: jobTemplate.parameters ?? undefined,
    timeoutMs: jobTemplate.timeoutMs ?? null,
    retryPolicy: jobTemplate.retryPolicy ?? null,
    storeResultAs: jobTemplate.storeResultAs ?? undefined
  } satisfies WorkflowFanOutTemplateDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }
  if (produces) {
    normalized.produces = produces;
  }
  if (consumes) {
    normalized.consumes = consumes;
  }
  return normalized;
}

export async function normalizeWorkflowSteps(
  steps: WorkflowStepInput[]
): Promise<WorkflowStepDefinition[]> {
  const jobSlugs = collectWorkflowJobSlugs(steps);
  const jobDefinitions = await getJobDefinitionsBySlugs(jobSlugs);

  return steps.map((step) => {
    if (step.type === 'fanout') {
      const produces = normalizeAssetDeclarations(step.produces);
      const consumes = normalizeAssetDeclarations(step.consumes);

      const definition: WorkflowStepDefinition = {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
        type: 'fanout',
        collection: step.collection,
        template: normalizeWorkflowFanOutTemplate(step.template, jobDefinitions),
        maxItems: step.maxItems ?? null,
        maxConcurrency: step.maxConcurrency ?? null,
        storeResultsAs: step.storeResultsAs ?? undefined
      } satisfies WorkflowStepDefinition;

      if (produces) {
        definition.produces = produces;
      }
      if (consumes) {
        definition.consumes = consumes;
      }
      return definition;
    }

    if (step.type === 'service') {
      const produces = normalizeAssetDeclarations(step.produces);
      const consumes = normalizeAssetDeclarations(step.consumes);

      const definition: WorkflowStepDefinition = {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
        type: 'service',
        serviceSlug: step.serviceSlug.trim().toLowerCase(),
        parameters: step.parameters ?? undefined,
        timeoutMs: step.timeoutMs ?? null,
        retryPolicy: step.retryPolicy ?? null,
        requireHealthy: step.requireHealthy ?? undefined,
        allowDegraded: step.allowDegraded ?? undefined,
        captureResponse: step.captureResponse ?? undefined,
        storeResponseAs: step.storeResponseAs ?? undefined,
        request: step.request
      } satisfies WorkflowStepDefinition;

      if (produces) {
        definition.produces = produces;
      }
      if (consumes) {
        definition.consumes = consumes;
      }
      return definition;
    }

    return normalizeWorkflowJobStep(step as WorkflowJobStepInput, jobDefinitions);
  });
}

export function normalizeWorkflowSchedule(schedule?: WorkflowTriggerInput['schedule']) {
  if (!schedule) {
    return undefined;
  }

  return {
    cron: schedule.cron.trim(),
    timezone: schedule.timezone ? schedule.timezone.trim() : null,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp ?? false
  };
}

export function normalizeWorkflowTriggers(triggers?: WorkflowTriggerInput[]) {
  if (!triggers) {
    return undefined;
  }
  return triggers.map((trigger) => {
    const schedule = normalizeWorkflowSchedule(trigger.schedule);
    const type = trigger.type.trim();
    const payload: {
      type: string;
      options: JsonValue | null;
      schedule?: ReturnType<typeof normalizeWorkflowSchedule>;
    } = {
      type,
      options: (trigger.options ?? null) as JsonValue | null
    };

    if (schedule) {
      payload.schedule = schedule;
    }

    return payload;
  });
}
