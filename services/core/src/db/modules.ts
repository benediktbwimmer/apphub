import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  ModuleManifest,
  ModuleManifestTarget,
  ModuleManifestValueDescriptor
} from '@apphub/module-sdk';
import {
  mapModuleArtifactRow,
  mapModuleRow,
  mapModuleTargetRow
} from './rowMappers';
import {
  type ModuleArtifactRecord,
  type ModuleRecord,
  type ModuleTargetMetadata,
  type ModuleTargetRecord,
  type ModuleTargetValueDescriptorMetadata,
  type ModuleTargetWorkflowMetadata,
  type ModuleTargetKind
} from './types';
import type { ModuleArtifactRow, ModuleRow, ModuleTargetRow } from './rowTypes';
import { useConnection, useTransaction } from './utils';

interface ModuleTargetInsert {
  name: string;
  kind: ModuleTargetKind;
  version: string;
  fingerprint: string;
  displayName: string | null;
  description: string | null;
  capabilityOverrides: string[];
  metadata: ModuleTargetMetadata;
}

export interface ModuleArtifactPublishInput {
  moduleId: string;
  moduleVersion: string;
  displayName?: string | null;
  description?: string | null;
  keywords?: string[];
  manifest: ModuleManifest;
  artifactPath: string;
  artifactChecksum: string;
  artifactStorage?: string;
  artifactContentType?: string | null;
  artifactSize?: number | null;
}

export interface ModuleArtifactPublishResult {
  module: ModuleRecord;
  artifact: ModuleArtifactRecord;
  targets: ModuleTargetRecord[];
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModuleId(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error('Module identifier is required');
  }
  return normalized;
}

function normalizeSemver(value: string, label: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeKeywordsList(keywordLists: (string[] | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const list of keywordLists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      if (!seen.has(trimmed.toLowerCase())) {
        seen.set(trimmed.toLowerCase(), trimmed);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeArtifactStorage(value: string | undefined): string {
  if (typeof value !== 'string') {
    return 'filesystem';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 's3') {
    return 's3';
  }
  if (normalized === 'filesystem') {
    return 'filesystem';
  }
  return normalized || 'filesystem';
}

function uniqueSorted(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    seen.add(value);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function descriptorToMetadata(
  descriptor: ModuleManifestValueDescriptor | undefined
): ModuleTargetValueDescriptorMetadata | undefined {
  if (!descriptor) {
    return undefined;
  }
  const metadata: ModuleTargetValueDescriptorMetadata = {
    hasResolve: Boolean(descriptor.hasResolve)
  } satisfies ModuleTargetValueDescriptorMetadata;

  if (Object.prototype.hasOwnProperty.call(descriptor, 'defaults')) {
    metadata.defaults = cloneJsonValue(descriptor.defaults ?? null) as ModuleTargetValueDescriptorMetadata['defaults'];
  }

  return metadata;
}

function buildTargetMetadata(target: ModuleManifestTarget): ModuleTargetMetadata {
  const metadata: ModuleTargetMetadata = {};

  const settingsMetadata = descriptorToMetadata(target.settings);
  if (settingsMetadata) {
    metadata.settings = settingsMetadata;
  }

  const secretsMetadata = descriptorToMetadata(target.secrets);
  if (secretsMetadata) {
    metadata.secrets = secretsMetadata;
  }

  const parametersMetadata = descriptorToMetadata(target.parameters);
  if (parametersMetadata) {
    metadata.parameters = parametersMetadata;
  }

  if (target.workflow) {
    metadata.workflow = {
      definition: cloneJsonValue(target.workflow.definition) as ModuleTargetWorkflowMetadata['definition'],
      triggers: cloneJsonValue(target.workflow.triggers) as unknown as ModuleTargetWorkflowMetadata['triggers'],
      schedules: cloneJsonValue(target.workflow.schedules) as unknown as ModuleTargetWorkflowMetadata['schedules']
    };
  }

  return metadata;
}

function buildTargetInsert(target: ModuleManifestTarget): ModuleTargetInsert {
  return {
    name: target.name,
    kind: target.kind,
    version: target.version,
    fingerprint: target.fingerprint,
    displayName: normalizeText(target.displayName ?? null),
    description: normalizeText(target.description ?? null),
    capabilityOverrides: uniqueSorted(target.capabilityOverrides ?? []),
    metadata: buildTargetMetadata(target)
  } satisfies ModuleTargetInsert;
}

async function upsertModuleRecord(
  client: PoolClient,
  input: {
    moduleId: string;
    displayName: string | null;
    description: string | null;
    keywords: string[];
    latestVersion: string;
    enabled?: boolean;
  }
): Promise<ModuleRow> {
  const enabled = input.enabled ?? null;
  const { rows } = await client.query<ModuleRow>(
    `INSERT INTO modules (id, display_name, description, keywords, latest_version, is_enabled)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE))
     ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           keywords = EXCLUDED.keywords,
            latest_version = EXCLUDED.latest_version,
            is_enabled = CASE WHEN $6 IS NULL THEN modules.is_enabled ELSE EXCLUDED.is_enabled END,
            updated_at = NOW()
     RETURNING *`,
    [
      input.moduleId,
      input.displayName,
      input.description,
      input.keywords,
      input.latestVersion,
      enabled
    ]
  );

  return rows[0];
}

async function upsertModuleArtifactRecord(
  client: PoolClient,
  input: {
    artifactId: string | null;
    moduleId: string;
    version: string;
    manifest: ModuleManifest;
    artifactChecksum: string;
    artifactPath: string;
    artifactStorage: string;
    artifactContentType: string | null;
    artifactSize: number | null;
  }
): Promise<ModuleArtifactRow> {
  if (input.artifactId) {
    const { rows } = await client.query<ModuleArtifactRow>(
      `UPDATE module_artifacts
         SET manifest = $2,
             artifact_checksum = $3,
             artifact_path = $4,
             artifact_storage = $5,
             artifact_content_type = $6,
             artifact_size = $7,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        input.artifactId,
        input.manifest,
        input.artifactChecksum,
        input.artifactPath,
        input.artifactStorage,
        input.artifactContentType,
        input.artifactSize
      ]
    );
    if (rows.length > 0) {
      return rows[0];
    }
  }

  const newId = randomUUID();
  const { rows } = await client.query<ModuleArtifactRow>(
    `INSERT INTO module_artifacts (
       id,
       module_id,
       version,
       manifest,
       artifact_checksum,
       artifact_path,
       artifact_storage,
       artifact_content_type,
       artifact_size
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      newId,
      input.moduleId,
      input.version,
      input.manifest,
      input.artifactChecksum,
      input.artifactPath,
      input.artifactStorage,
      input.artifactContentType,
      input.artifactSize
    ]
  );

  return rows[0];
}

async function replaceModuleTargets(
  client: PoolClient,
  options: {
    moduleId: string;
    moduleVersion: string;
    artifactId: string;
    targets: ModuleTargetInsert[];
  }
): Promise<ModuleTargetRow[]> {
  await client.query('DELETE FROM module_targets WHERE artifact_id = $1', [options.artifactId]);

  const inserted: ModuleTargetRow[] = [];
  for (const target of options.targets) {
    const { rows } = await client.query<ModuleTargetRow>(
      `INSERT INTO module_targets (
         id,
         module_id,
         module_version,
         artifact_id,
         target_name,
         target_kind,
         target_version,
         fingerprint,
         display_name,
         description,
         capability_overrides,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        randomUUID(),
        options.moduleId,
        options.moduleVersion,
        options.artifactId,
        target.name,
        target.kind,
        target.version,
        target.fingerprint,
        target.displayName,
        target.description,
        target.capabilityOverrides,
        target.metadata
      ]
    );
    inserted.push(rows[0]);
  }

  return inserted;
}

async function findExistingArtifactId(
  client: PoolClient,
  moduleId: string,
  moduleVersion: string
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM module_artifacts WHERE module_id = $1 AND version = $2',
    [moduleId, moduleVersion]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function fetchModuleArtifactRow(
  client: PoolClient,
  moduleId: string,
  moduleVersion: string
): Promise<ModuleArtifactRow | null> {
  const { rows } = await client.query<ModuleArtifactRow>(
    'SELECT * FROM module_artifacts WHERE module_id = $1 AND version = $2',
    [moduleId, moduleVersion]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function listModuleTargetRowsForArtifact(
  client: PoolClient,
  artifactId: string
): Promise<ModuleTargetRow[]> {
  const { rows } = await client.query<ModuleTargetRow>(
    'SELECT * FROM module_targets WHERE artifact_id = $1 ORDER BY target_name ASC',
    [artifactId]
  );
  return rows;
}

async function fetchModuleTargetRow(
  client: PoolClient,
  moduleId: string,
  moduleVersion: string,
  targetName: string,
  targetVersion?: string | null
): Promise<ModuleTargetRow | null> {
  const params: unknown[] = [moduleId, moduleVersion, targetName];
  let query = `SELECT * FROM module_targets
               WHERE module_id = $1 AND module_version = $2 AND target_name = $3`;
  if (targetVersion) {
    params.push(targetVersion);
    query += ' AND target_version = $4';
  }
  const { rows } = await client.query<ModuleTargetRow>(`${query} ORDER BY created_at DESC LIMIT 1`, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function publishModuleArtifact(
  input: ModuleArtifactPublishInput
): Promise<ModuleArtifactPublishResult> {
  const moduleId = normalizeModuleId(input.moduleId);
  const moduleVersion = normalizeSemver(input.moduleVersion, 'Module version');

  if (input.manifest.metadata.version !== moduleVersion) {
    throw new Error(
      `Manifest version mismatch: expected ${moduleVersion}, received ${input.manifest.metadata.version}`
    );
  }

  if (!Array.isArray(input.manifest.targets) || input.manifest.targets.length === 0) {
    throw new Error('Module manifest must include at least one target.');
  }

  const displayName = normalizeText(input.displayName ?? input.manifest.metadata.displayName ?? null);
  const description = normalizeText(input.description ?? input.manifest.metadata.description ?? null);
  const keywords = normalizeKeywordsList([input.keywords, input.manifest.metadata.keywords]);
  const artifactPath = normalizeText(input.artifactPath) ?? (() => {
    throw new Error('artifactPath is required');
  })();
  const artifactChecksum = normalizeText(input.artifactChecksum) ?? (() => {
    throw new Error('artifactChecksum is required');
  })();
  const artifactStorage = normalizeArtifactStorage(input.artifactStorage);
  const artifactContentType = normalizeText(input.artifactContentType ?? null);
  const artifactSize =
    typeof input.artifactSize === 'number' && Number.isFinite(input.artifactSize)
      ? Math.max(0, Math.trunc(input.artifactSize))
      : null;

  const seenFingerprints = new Set<string>();
  const targetInserts = input.manifest.targets.map((target) => {
    if (!target.version) {
      throw new Error(`Target "${target.name}" is missing a version.`);
    }
    if (!target.fingerprint) {
      throw new Error(`Target "${target.name}" is missing a fingerprint.`);
    }
    if (seenFingerprints.has(target.fingerprint)) {
      throw new Error(`Duplicate target fingerprint detected: ${target.fingerprint}`);
    }
    seenFingerprints.add(target.fingerprint);
    return buildTargetInsert(target);
  });

  return useTransaction(async (client) => {
    const moduleRow = await upsertModuleRecord(client, {
      moduleId,
      displayName,
      description,
      keywords,
      latestVersion: moduleVersion
    });

    const existingArtifactId = await findExistingArtifactId(client, moduleId, moduleVersion);
    const artifactRow = await upsertModuleArtifactRecord(client, {
      artifactId: existingArtifactId,
      moduleId,
      version: moduleVersion,
      manifest: input.manifest,
      artifactChecksum,
      artifactPath,
      artifactStorage,
      artifactContentType,
      artifactSize
    });

    const targetRows = await replaceModuleTargets(client, {
      moduleId,
      moduleVersion,
      artifactId: artifactRow.id,
      targets: targetInserts
    });

    const moduleRecord = mapModuleRow(moduleRow);
    const artifactRecord = mapModuleArtifactRow(artifactRow);
    const targetRecords = targetRows.map(mapModuleTargetRow);
    artifactRecord.targets = targetRecords;

    return {
      module: moduleRecord,
      artifact: artifactRecord,
      targets: targetRecords
    } satisfies ModuleArtifactPublishResult;
  });
}

export async function getModuleArtifact(options: {
  moduleId: string;
  moduleVersion: string;
}): Promise<ModuleArtifactRecord | null> {
  const moduleId = normalizeModuleId(options.moduleId);
  const moduleVersion = normalizeSemver(options.moduleVersion, 'Module version');

  return useConnection(async (client) => {
    const artifactRow = await fetchModuleArtifactRow(client, moduleId, moduleVersion);
    if (!artifactRow) {
      return null;
    }
    const targetRows = await listModuleTargetRowsForArtifact(client, artifactRow.id);
    const artifactRecord = mapModuleArtifactRow(artifactRow);
    artifactRecord.targets = targetRows.map(mapModuleTargetRow);
    return artifactRecord;
  });
}

export async function getModuleTarget(options: {
  moduleId: string;
  moduleVersion: string;
  targetName: string;
  targetVersion?: string | null;
  allowDisabled?: boolean;
}): Promise<{ module: ModuleRecord; artifact: ModuleArtifactRecord; target: ModuleTargetRecord } | null> {
  const moduleId = normalizeModuleId(options.moduleId);
  const moduleVersion = normalizeSemver(options.moduleVersion, 'Module version');
  const targetName = normalizeText(options.targetName) ?? (() => {
    throw new Error('Target name is required');
  })();
  const targetVersion = normalizeText(options.targetVersion ?? null);

  return useConnection(async (client) => {
    const moduleRowResult = await client.query<ModuleRow>(
      'SELECT * FROM modules WHERE id = $1',
      [moduleId]
    );
    if (moduleRowResult.rows.length === 0) {
      return null;
    }
    const moduleRecord = mapModuleRow(moduleRowResult.rows[0]);

    const artifactRow = await fetchModuleArtifactRow(client, moduleId, moduleVersion);
    if (!artifactRow) {
      return null;
    }
    const targetRow = await fetchModuleTargetRow(client, moduleId, moduleVersion, targetName, targetVersion);
    if (!targetRow) {
      return null;
    }
    const artifactRecord = mapModuleArtifactRow(artifactRow);
    const targetRecord = mapModuleTargetRow(targetRow);
    if (!moduleRecord.isEnabled && !options.allowDisabled) {
      throw new Error(`Module ${moduleId}@${moduleVersion} is disabled`);
    }
    return {
      module: moduleRecord,
      artifact: artifactRecord,
      target: targetRecord
    };
  });
}

export async function listModules(): Promise<ModuleRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ModuleRow>(
      'SELECT * FROM modules ORDER BY id ASC'
    );
    return rows.map(mapModuleRow);
  });
}

export async function setModuleEnablement(options: {
  moduleId: string;
  enabled: boolean;
}): Promise<ModuleRecord | null> {
  const moduleId = normalizeModuleId(options.moduleId);
  const enabledValue = Boolean(options.enabled);

  return useConnection(async (client) => {
    const { rows } = await client.query<ModuleRow>(
      `UPDATE modules
         SET is_enabled = $2,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [moduleId, enabledValue]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapModuleRow(rows[0]);
  });
}
