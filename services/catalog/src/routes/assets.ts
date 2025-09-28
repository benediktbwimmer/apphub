import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  listWorkflowDefinitions,
  listWorkflowAssetDeclarations,
  listLatestWorkflowAssetSnapshots,
  listWorkflowAssetStalePartitions,
  markWorkflowAssetPartitionStale,
  clearWorkflowAssetPartitionStale,
  getWorkflowDefinitionBySlug
} from '../db/workflows';
import type {
  WorkflowAssetAutoMaterialize,
  WorkflowAssetDeclarationRecord,
  WorkflowAssetFreshness,
  WorkflowAssetPartitioning,
  WorkflowAssetSnapshotRecord,
  WorkflowAssetStalePartitionRecord,
  WorkflowDefinitionRecord,
  WorkflowStepDefinition
} from '../db/types';
import { requireOperatorScopes } from './shared/operatorAuth';
import { WORKFLOW_RUN_SCOPES } from './shared/scopes';
import { validatePartitionKey } from '../workflows/partitioning';
import { canonicalAssetId, normalizeAssetId } from '../assets/identifiers';

const ASSET_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

const workflowAssetParamSchema = z
  .object({
    slug: z.string().min(1),
    assetId: z
      .string()
      .min(1)
      .max(200)
      .regex(ASSET_ID_PATTERN, 'Invalid asset ID')
  })
  .strict();

const staleRequestSchema = z
  .object({
    partitionKey: z.string().min(1).max(200).optional(),
    note: z.string().min(1).max(500).optional()
  })
  .strict();

const staleQuerySchema = z
  .object({
    partitionKey: z.string().min(1).max(200).optional()
  })
  .partial();

type StepMetadata = {
  name: string;
  type: WorkflowStepDefinition['type'];
};

type AssetGraphProducer = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: WorkflowStepDefinition['type'];
  partitioning: WorkflowAssetPartitioning | null;
  autoMaterialize: WorkflowAssetAutoMaterialize | null;
  freshness: WorkflowAssetFreshness | null;
};

type AssetGraphConsumer = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: WorkflowStepDefinition['type'];
};

type AssetGraphMaterialization = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  runId: string;
  stepId: string;
  stepName: string;
  stepType: WorkflowStepDefinition['type'];
  runStatus: string;
  stepStatus: string;
  producedAt: string;
  partitionKey: string | null;
  freshness: WorkflowAssetFreshness | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
};

type AssetGraphStalePartition = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  partitionKey: string | null;
  requestedAt: string;
  requestedBy: string | null;
  note: string | null;
};

type AssetGraphEdge = {
  fromAssetId: string;
  fromAssetNormalizedId: string;
  toAssetId: string;
  toAssetNormalizedId: string;
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: WorkflowStepDefinition['type'];
};

type AssetGraphNode = {
  assetId: string;
  normalizedAssetId: string;
  producers: AssetGraphProducer[];
  consumers: AssetGraphConsumer[];
  latestMaterializations: AssetGraphMaterialization[];
  stalePartitions: AssetGraphStalePartition[];
};

type StepAssetRoles = {
  produces: Set<string>;
  consumes: Set<string>;
};

function buildWorkflowStepMetadata(steps: WorkflowStepDefinition[]): Map<string, StepMetadata> {
  const metadata = new Map<string, StepMetadata>();

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

function ensureAggregateNode(map: Map<string, AssetGraphNode>, assetId: string): AssetGraphNode {
  const normalized = normalizeAssetId(assetId);
  const existing = map.get(normalized);
  if (existing) {
    return existing;
  }
  const node: AssetGraphNode = {
    assetId,
    normalizedAssetId: normalized,
    producers: [],
    consumers: [],
    latestMaterializations: [],
    stalePartitions: []
  };
  map.set(normalized, node);
  return node;
}

function getLatestProducedAt(materializations: AssetGraphMaterialization[]): number | null {
  let latest: number | null = null;
  for (const materialization of materializations) {
    const producedAt = Date.parse(materialization.producedAt);
    if (Number.isNaN(producedAt)) {
      continue;
    }
    if (latest === null || producedAt > latest) {
      latest = producedAt;
    }
  }
  return latest;
}

function mapSnapshotToMaterialization(
  snapshot: WorkflowAssetSnapshotRecord,
  workflowId: string,
  workflowSlug: string,
  workflowName: string,
  stepMetadata: Map<string, StepMetadata>
): AssetGraphMaterialization {
  const stepMeta = stepMetadata.get(snapshot.workflowStepId);
  return {
    workflowId,
    workflowSlug,
    workflowName,
    runId: snapshot.workflowRunId,
    stepId: snapshot.workflowStepId,
    stepName: stepMeta?.name ?? snapshot.workflowStepId,
    stepType: stepMeta?.type ?? 'job',
    runStatus: snapshot.runStatus,
    stepStatus: snapshot.stepStatus,
    producedAt: snapshot.asset.producedAt,
    partitionKey: snapshot.asset.partitionKey,
    freshness: snapshot.asset.freshness,
    runStartedAt: snapshot.runStartedAt,
    runCompletedAt: snapshot.runCompletedAt
  } satisfies AssetGraphMaterialization;
}

function mapStalePartition(
  stale: WorkflowAssetStalePartitionRecord,
  workflowId: string,
  workflowSlug: string,
  workflowName: string
): AssetGraphStalePartition {
  return {
    workflowId,
    workflowSlug,
    workflowName,
    partitionKey: stale.partitionKey,
    requestedAt: stale.requestedAt,
    requestedBy: stale.requestedBy,
    note: stale.note ?? null
  } satisfies AssetGraphStalePartition;
}

function buildStepAssetRoles(
  declarations: WorkflowAssetDeclarationRecord[]
): Map<string, StepAssetRoles> {
  const roles = new Map<string, StepAssetRoles>();
  for (const declaration of declarations) {
    const stepId = declaration.stepId;
    const entry = roles.get(stepId) ?? { produces: new Set<string>(), consumes: new Set<string>() };
    const canonical = canonicalAssetId(declaration.assetId);
    if (!canonical) {
      continue;
    }
    const normalized = normalizeAssetId(canonical);
    if (declaration.direction === 'produces') {
      entry.produces.add(normalized);
    } else {
      entry.consumes.add(normalized);
    }
    roles.set(stepId, entry);
  }
  return roles;
}

function selectPartitioning(
  declarations: WorkflowAssetDeclarationRecord[]
): WorkflowAssetPartitioning | null {
  const producer = declarations.find((declaration) => declaration.direction === 'produces');
  return producer?.partitioning ?? null;
}

async function resolveWorkflowAsset(
  slug: string,
  assetId: string
): Promise<
  | {
      ok: true;
      workflow: WorkflowDefinitionRecord;
      declarations: WorkflowAssetDeclarationRecord[];
      partitioning: WorkflowAssetPartitioning | null;
    }
  | { ok: false; statusCode: number; error: string }
> {
  const workflow = await getWorkflowDefinitionBySlug(slug);
  if (!workflow) {
    return { ok: false, statusCode: 404, error: 'workflow not found' };
  }

  const declarations = await listWorkflowAssetDeclarations(workflow.id);
  const matches = declarations.filter(
    (declaration) =>
      declaration.workflowDefinitionId === workflow.id &&
      declaration.assetId.toLowerCase() === assetId.toLowerCase()
  );

  if (matches.length === 0) {
    return { ok: false, statusCode: 404, error: 'asset not found for workflow' };
  }

  return {
    ok: true,
    workflow,
    declarations: matches,
    partitioning: selectPartitioning(matches)
  } as const;
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/assets/graph', async (_request, reply) => {
    const workflows = await listWorkflowDefinitions();
    const aggregates = new Map<string, AssetGraphNode>();
    const edges: AssetGraphEdge[] = [];
    const edgeKeys = new Set<string>();

    for (const workflow of workflows) {
      const stepMetadata = buildWorkflowStepMetadata(workflow.steps);
      const declarations = await listWorkflowAssetDeclarations(workflow.id);
      const latestSnapshots = await listLatestWorkflowAssetSnapshots(workflow.id);
      const stalePartitions = await listWorkflowAssetStalePartitions(workflow.id);
      const rolesByStep = buildStepAssetRoles(declarations);

      for (const declaration of declarations) {
        const canonical = canonicalAssetId(declaration.assetId);
        if (!canonical) {
          continue;
        }
        const node = ensureAggregateNode(aggregates, canonical);
        const stepMeta = stepMetadata.get(declaration.stepId);
        const roleBase = {
          workflowId: workflow.id,
          workflowSlug: workflow.slug,
          workflowName: workflow.name,
          stepId: declaration.stepId,
          stepName: stepMeta?.name ?? declaration.stepId,
          stepType: stepMeta?.type ?? 'job'
        };

        if (declaration.direction === 'produces') {
          node.producers.push({
            ...roleBase,
            partitioning: declaration.partitioning ?? null,
            autoMaterialize: declaration.autoMaterialize ?? null,
            freshness: declaration.freshness ?? null
          });
        } else {
          node.consumers.push(roleBase);
        }
      }

      for (const snapshot of latestSnapshots) {
        const canonical = canonicalAssetId(snapshot.asset.assetId);
        if (!canonical) {
          continue;
        }
        const node = ensureAggregateNode(aggregates, canonical);
        node.latestMaterializations.push(
          mapSnapshotToMaterialization(snapshot, workflow.id, workflow.slug, workflow.name, stepMetadata)
        );
      }

      for (const stale of stalePartitions) {
        const canonical = canonicalAssetId(stale.assetId);
        if (!canonical) {
          continue;
        }
        const node = ensureAggregateNode(aggregates, canonical);
        node.stalePartitions.push(mapStalePartition(stale, workflow.id, workflow.slug, workflow.name));
      }

      for (const [stepId, roles] of rolesByStep.entries()) {
        if (roles.consumes.size === 0 || roles.produces.size === 0) {
          continue;
        }
        const stepMeta = stepMetadata.get(stepId);
        for (const from of roles.consumes) {
          for (const to of roles.produces) {
            if (from === to) {
              continue;
            }
            const edgeKey = `${from}->${to}@${workflow.id}:${stepId}`;
            if (edgeKeys.has(edgeKey)) {
              continue;
            }
            edgeKeys.add(edgeKey);
            const fromNode = aggregates.get(from);
            const toNode = aggregates.get(to);
            edges.push({
              fromAssetId: fromNode?.assetId ?? from,
              fromAssetNormalizedId: from,
              toAssetId: toNode?.assetId ?? to,
              toAssetNormalizedId: to,
              workflowId: workflow.id,
              workflowSlug: workflow.slug,
              workflowName: workflow.name,
              stepId,
              stepName: stepMeta?.name ?? stepId,
              stepType: stepMeta?.type ?? 'job'
            });
          }
        }
      }
    }

    const latestProducedAtByAsset = new Map<string, number | null>();
    for (const node of aggregates.values()) {
      latestProducedAtByAsset.set(node.normalizedAssetId, getLatestProducedAt(node.latestMaterializations));
    }

    const upstreamByAsset = new Map<string, Set<string>>();
    for (const edge of edges) {
      const upstream = upstreamByAsset.get(edge.toAssetNormalizedId);
      if (upstream) {
        upstream.add(edge.fromAssetNormalizedId);
      } else {
        upstreamByAsset.set(edge.toAssetNormalizedId, new Set([edge.fromAssetNormalizedId]));
      }
    }

    const assets = Array.from(aggregates.values()).map((node) => {
      const latestMaterializations = [...node.latestMaterializations].sort((a, b) => {
        const aTime = Date.parse(a.producedAt);
        const bTime = Date.parse(b.producedAt);
        if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
          return bTime - aTime;
        }
        if (!Number.isNaN(aTime)) {
          return -1;
        }
        if (!Number.isNaN(bTime)) {
          return 1;
        }
        return 0;
      });

      const upstreamSources = upstreamByAsset.get(node.normalizedAssetId);
      const downstreamProducedAt = latestProducedAtByAsset.get(node.normalizedAssetId) ?? null;
      const outdatedUpstreams = new Set<string>();

      if (upstreamSources) {
        for (const upstreamNormalizedId of upstreamSources) {
          const upstreamNode = aggregates.get(upstreamNormalizedId);
          if (!upstreamNode) {
            continue;
          }
          const upstreamProducedAt = latestProducedAtByAsset.get(upstreamNormalizedId) ?? null;
          if (upstreamProducedAt === null) {
            continue;
          }
          if (downstreamProducedAt === null || upstreamProducedAt > downstreamProducedAt) {
            outdatedUpstreams.add(upstreamNode.assetId);
          }
        }
      }

      const outdatedUpstreamAssetIds = Array.from(outdatedUpstreams).sort((a, b) => a.localeCompare(b));

      return {
        assetId: node.assetId,
        normalizedAssetId: node.normalizedAssetId,
        producers: node.producers,
        consumers: node.consumers,
        latestMaterializations,
        stalePartitions: node.stalePartitions,
        hasStalePartitions: node.stalePartitions.length > 0,
        hasOutdatedUpstreams: outdatedUpstreamAssetIds.length > 0,
        outdatedUpstreamAssetIds
      };
    });

    assets.sort((a, b) => a.assetId.localeCompare(b.assetId));
    edges.sort((a, b) => {
      if (a.fromAssetNormalizedId === b.fromAssetNormalizedId) {
        if (a.toAssetNormalizedId === b.toAssetNormalizedId) {
          return a.workflowSlug.localeCompare(b.workflowSlug);
        }
        return a.toAssetNormalizedId.localeCompare(b.toAssetNormalizedId);
      }
      return a.fromAssetNormalizedId.localeCompare(b.fromAssetNormalizedId);
    });

    reply.status(200);
    return { data: { assets, edges } };
  });

  app.post('/workflows/:slug/assets/:assetId/stale', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.assets.mark-stale',
      resource: 'workflow:asset',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseBody = staleRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const assetTarget = await resolveWorkflowAsset(parseParams.data.slug, parseParams.data.assetId);
    if (!assetTarget.ok) {
      reply.status(assetTarget.statusCode);
      return { error: assetTarget.error };
    }

    const { workflow, partitioning } = assetTarget;
    const suppliedKey = parseBody.data.partitionKey ?? null;
    let partitionKey: string | null = null;

    if (partitioning) {
      if (!suppliedKey) {
        reply.status(400);
        return { error: 'partitionKey is required for partitioned assets' };
      }
      const validation = validatePartitionKey(partitioning, suppliedKey);
      if (!validation.ok) {
        reply.status(400);
        return { error: validation.error };
      }
      partitionKey = validation.key;
    } else if (typeof suppliedKey === 'string' && suppliedKey.trim().length > 0) {
      partitionKey = suppliedKey.trim();
    }

    await markWorkflowAssetPartitionStale(workflow.id, parseParams.data.assetId, partitionKey, {
      requestedBy: authResult.auth.identity.subject,
      note: parseBody.data.note
    });

    await authResult.auth.log('succeeded', {
      action: 'assets.mark_stale',
      workflowSlug: workflow.slug,
      assetId: parseParams.data.assetId,
      partitionKey
    });

    reply.status(204);
    return null;
  });

  app.delete('/workflows/:slug/assets/:assetId/stale', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.assets.clear-stale',
      resource: 'workflow:asset',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = staleQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const assetTarget = await resolveWorkflowAsset(parseParams.data.slug, parseParams.data.assetId);
    if (!assetTarget.ok) {
      reply.status(assetTarget.statusCode);
      return { error: assetTarget.error };
    }

    const { workflow, partitioning } = assetTarget;
    const suppliedKey = parseQuery.data.partitionKey ?? null;
    let partitionKey: string | null = null;

    if (partitioning) {
      if (!suppliedKey) {
        reply.status(400);
        return { error: 'partitionKey is required for partitioned assets' };
      }
      const validation = validatePartitionKey(partitioning, suppliedKey);
      if (!validation.ok) {
        reply.status(400);
        return { error: validation.error };
      }
      partitionKey = validation.key;
    } else if (typeof suppliedKey === 'string' && suppliedKey.trim().length > 0) {
      partitionKey = suppliedKey.trim();
    }

    await clearWorkflowAssetPartitionStale(workflow.id, parseParams.data.assetId, partitionKey);

    await authResult.auth.log('succeeded', {
      action: 'assets.clear_stale',
      workflowSlug: workflow.slug,
      assetId: parseParams.data.assetId,
      partitionKey
    });

    reply.status(204);
    return null;
  });
}
