import type { ManifestEnvVarInput } from '../serviceManifestTypes';
import {
  type BuildRecord,
  type IngestStatus,
  type LaunchEnvVar,
  type LaunchRecord,
  type JsonValue,
  type RepositoryPreview,
  type RepositoryPreviewKind,
  type RepositoryRecord,
  type TagKV,
  type BuildStatus,
  type LaunchStatus,
  type ServiceNetworkMemberRecord,
  type ServiceNetworkRecord,
  type ServiceNetworkLaunchMemberRecord
} from './types';
import type {
  BuildRow,
  IngestionEventRow,
  LaunchRow,
  RepositoryPreviewRow,
  RepositoryRow,
  ServiceNetworkLaunchMemberRow,
  ServiceNetworkMemberRow,
  ServiceNetworkRow,
  ServiceRow,
  TagRow
} from './rowTypes';
import type { ServiceRecord, IngestionEvent } from './types';

export function parseLaunchEnv(value: unknown): LaunchEnvVar[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const key = typeof (entry as any).key === 'string' ? (entry as any).key.trim() : '';
        if (!key) {
          return null;
        }
        const rawValue = (entry as any).value;
        return { key, value: typeof rawValue === 'string' ? rawValue : '' } satisfies LaunchEnvVar;
      })
      .filter((entry): entry is LaunchEnvVar => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseLaunchEnv(parsed);
    } catch {
      return [];
    }
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => ({ key, value: typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw) }))
      .filter((entry) => entry.key.length > 0);
  }
  return [];
}

export function parseManifestEnv(value: unknown): ManifestEnvVarInput[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const key = typeof (entry as any).key === 'string' ? (entry as any).key.trim() : '';
        if (!key) {
          return null;
        }
        const clone: ManifestEnvVarInput = { key };
        if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
          const rawValue = (entry as any).value;
          if (rawValue === undefined || rawValue === null) {
            clone.value = undefined;
          } else {
            clone.value = String(rawValue);
          }
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'fromService')) {
          const ref = (entry as any).fromService;
          if (ref && typeof ref === 'object') {
            const service = typeof ref.service === 'string' ? ref.service : undefined;
            if (service) {
              clone.fromService = {
                service,
                property: typeof ref.property === 'string' ? ref.property : undefined,
                fallback:
                  ref.fallback === undefined || ref.fallback === null ? undefined : String(ref.fallback)
              };
            }
          }
        }
        return clone;
      })
      .filter((entry): entry is ManifestEnvVarInput => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseManifestEnv(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function parseStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseStringArray(parsed);
    } catch {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return [];
}

export function mapRepositoryRow(
  row: RepositoryRow,
  options: {
    tags?: TagRow[];
    latestBuild?: BuildRow | null;
    latestLaunch?: LaunchRow | null;
    previews?: RepositoryPreviewRow[];
  } = {}
): RepositoryRecord {
  const tags = (options.tags ?? []).map(
    (tag) => ({ key: tag.key, value: tag.value, source: tag.source }) as TagKV
  );

  const launchEnvTemplates = parseLaunchEnv(row.launch_env_templates);

  const previews = (options.previews ?? []).map(mapRepositoryPreviewRow);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    dockerfilePath: row.dockerfile_path,
    updatedAt: row.updated_at,
    ingestStatus: row.ingest_status as IngestStatus,
    lastIngestedAt: row.last_ingested_at,
    createdAt: row.created_at,
    ingestError: row.ingest_error,
    ingestAttempts: row.ingest_attempts ?? 0,
    tags,
    latestBuild: options.latestBuild ? mapBuildRow(options.latestBuild) : null,
    latestLaunch: options.latestLaunch ? mapLaunchRow(options.latestLaunch) : null,
    previewTiles: previews,
    launchEnvTemplates
  } satisfies RepositoryRecord;
}

export function mapBuildRow(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status as BuildStatus,
    logs: row.logs ?? null,
    imageTag: row.image_tag ?? null,
    errorMessage: row.error_message ?? null,
    commitSha: row.commit_sha ?? null,
    gitBranch: row.branch ?? null,
    gitRef: row.git_ref ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    durationMs: row.duration_ms ?? null
  } satisfies BuildRecord;
}

export function mapLaunchRow(row: LaunchRow): LaunchRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    buildId: row.build_id,
    status: row.status as LaunchStatus,
    instanceUrl: row.instance_url ?? null,
    containerId: row.container_id ?? null,
    port: row.port ?? null,
    resourceProfile: row.resource_profile ?? null,
    env: parseLaunchEnv(row.env_vars),
    command: row.command ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    stoppedAt: row.stopped_at ?? null,
    expiresAt: row.expires_at ?? null
  } satisfies LaunchRecord;
}

export function mapRepositoryPreviewRow(row: RepositoryPreviewRow): RepositoryPreview {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    kind: row.kind as RepositoryPreviewKind,
    source: row.source,
    title: row.title,
    description: row.description,
    src: row.src,
    embedUrl: row.embed_url,
    posterUrl: row.poster_url,
    width: row.width ?? null,
    height: row.height ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  } satisfies RepositoryPreview;
}

export function mapIngestionEventRow(row: IngestionEventRow): IngestionEvent {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status as IngestStatus,
    message: row.message,
    attempt: row.attempt,
    commitSha: row.commit_sha,
    durationMs: row.duration_ms,
    createdAt: row.created_at
  } satisfies IngestionEvent;
}

export function mapServiceNetworkMemberRow(row: ServiceNetworkMemberRow): ServiceNetworkMemberRecord {
  return {
    networkRepositoryId: row.network_repository_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order ?? 0,
    waitForBuild: Boolean(row.wait_for_build),
    env: parseManifestEnv(row.env_vars),
    dependsOn: parseStringArray(row.depends_on),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceNetworkMemberRecord;
}

export function mapServiceNetworkRow(
  row: ServiceNetworkRow,
  members: ServiceNetworkMemberRow[] = []
): ServiceNetworkRecord {
  return {
    repositoryId: row.repository_id,
    manifestSource: row.manifest_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: members.map(mapServiceNetworkMemberRow)
  } satisfies ServiceNetworkRecord;
}

export function mapServiceNetworkLaunchMemberRow(
  row: ServiceNetworkLaunchMemberRow
): ServiceNetworkLaunchMemberRecord {
  return {
    networkLaunchId: row.network_launch_id,
    memberLaunchId: row.member_launch_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceNetworkLaunchMemberRecord;
}

function parseJsonColumn(value: unknown): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') {
    return value as JsonValue;
  }
  return null;
}

export function mapServiceRow(row: ServiceRow): ServiceRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    kind: row.kind,
    baseUrl: row.base_url,
    status: row.status as ServiceRecord['status'],
    statusMessage: row.status_message ?? null,
    capabilities: parseJsonColumn(row.capabilities),
    metadata: parseJsonColumn(row.metadata),
    lastHealthyAt: row.last_healthy_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceRecord;
}
