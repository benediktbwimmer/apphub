import process from 'node:process';

process.env.APPHUB_EVENTS_MODE = process.env.APPHUB_EVENTS_MODE ?? 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? '1';

type ModuleResourceContextUpsertInput = import('../db').ModuleResourceContextUpsertInput;
type JsonValue = import('../db').JsonValue;
type ModuleTargetRow = import('../db/rowTypes').ModuleTargetRow;

async function main() {
  const db = await import('../db');
  const dbUtils = await import('../db/utils');
  const rowMappers = await import('../db/rowMappers');
  const definitionsRepo = await import('../workflows/repositories/definitionsRepository');
  const runsRepo = await import('../workflows/repositories/runsRepository');

  const listWorkflowTargets = async (moduleId: string) => {
    const { rows } = await dbUtils.useConnection((client) =>
      client.query<ModuleTargetRow>(
        `SELECT *
           FROM module_targets
          WHERE module_id = $1
            AND target_kind = 'workflow'
          ORDER BY target_name ASC`,
        [moduleId]
      )
    );

    const targets: Array<{
      moduleVersion: string | null;
      slug: string;
      metadata: JsonValue | null;
      targetName: string;
    }> = [];

    for (const row of rows) {
      const mapped = rowMappers.mapModuleTargetRow(row);
      const workflowMetadata = mapped.metadata?.workflow;
      const definitionMetadata = workflowMetadata && typeof workflowMetadata === 'object'
        ? (workflowMetadata as Record<string, unknown>).definition
        : null;
      const slugValue =
        definitionMetadata && typeof definitionMetadata === 'object'
          ? (definitionMetadata as Record<string, unknown>).slug
          : undefined;
      const slug = typeof slugValue === 'string' && slugValue.trim().length > 0
        ? slugValue.trim()
        : mapped.name.trim();
      if (!slug) {
        continue;
      }
      targets.push({
        moduleVersion: mapped.moduleVersion ?? null,
        slug,
        metadata: workflowMetadata ? (workflowMetadata as JsonValue) : null,
        targetName: mapped.name
      });
    }

    return targets;
  };

  const buildWorkflowDefinitionMetadata = (
    definition: Awaited<ReturnType<typeof definitionsRepo.getWorkflowDefinitionBySlug>>,
    target: { metadata: JsonValue | null }
  ): JsonValue => {
    if (!definition) {
      throw new Error('Definition is required');
    }
    const metadata: Record<string, JsonValue> = {
      slug: definition.slug,
      name: definition.name,
      version: definition.version,
      parametersSchema: definition.parametersSchema,
      defaultParameters: definition.defaultParameters,
      dag: JSON.parse(JSON.stringify(definition.dag)) as JsonValue
    } satisfies Record<string, JsonValue>;

    if (definition.metadata) {
      metadata.metadata = definition.metadata as JsonValue;
    }

    if (target.metadata) {
      metadata.manifest = target.metadata;
    }

    return metadata;
  };

  const seedModuleWorkflowContexts = async (moduleId: string) => {
    const workflowTargets = await listWorkflowTargets(moduleId);
    if (workflowTargets.length === 0) {
      console.log(`[modules] No workflow targets found for module ${moduleId}`);
      return;
    }

    let definitionCount = 0;
    let runAssignments = 0;

    for (const workflowTarget of workflowTargets) {
      const definition = await definitionsRepo.getWorkflowDefinitionBySlug(workflowTarget.slug);
      if (!definition) {
        console.warn(
          `[modules] Skipping workflow target ${workflowTarget.slug} for module ${moduleId} (definition not found)`
        );
        continue;
      }

      const upsertInput: ModuleResourceContextUpsertInput = {
        moduleId,
        moduleVersion: workflowTarget.moduleVersion,
        resourceType: 'workflow-definition',
        resourceId: definition.id,
        resourceSlug: definition.slug,
        resourceName: definition.name,
        resourceVersion: String(definition.version),
        metadata: buildWorkflowDefinitionMetadata(definition, workflowTarget)
      };

      await db.upsertModuleResourceContext(upsertInput);
      definitionCount += 1;

      const processedRuns = await runsRepo.backfillWorkflowRunModuleContextsForDefinition(definition.id);
      runAssignments += processedRuns;
    }

    console.log(
      `[modules] Module ${moduleId}: upserted ${definitionCount} workflow definition contexts; synced ${runAssignments} workflow runs`
    );
  };

  try {
    const modules = await db.listModules();
    if (modules.length === 0) {
      console.log('[modules] No modules registered.');
      return;
    }

    for (const moduleRecord of modules) {
      await seedModuleWorkflowContexts(moduleRecord.id);
    }
  } catch (err) {
    console.error('[modules] Failed to backfill module resource contexts');
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
}

void main();
