import { useConnection, useTransaction } from './utils';
import { mapServiceManifestRow } from './rowMappers';
import type {
  ServiceManifestStoreInput,
  ServiceManifestStoreRecord
} from './types';
import type { ServiceManifestRow } from './rowTypes';

function serializeDefinition(definition: ServiceManifestStoreInput['definition']): string {
  return JSON.stringify(definition);
}

export async function replaceModuleManifests(
  moduleId: string,
  entries: ServiceManifestStoreInput[]
): Promise<number> {
  const normalizedModuleId = moduleId.trim();
  if (!normalizedModuleId) {
    throw new Error('moduleId is required to replace service manifests');
  }

  return useTransaction(async (client) => {
    const { rows: versionRows } = await client.query<{ max_version: number | null }>(
      `SELECT MAX(module_version) AS max_version
       FROM service_manifests
       WHERE module_id = $1`,
      [normalizedModuleId]
    );
    const nextVersion = Number(versionRows[0]?.max_version ?? 0) + 1;

    await client.query(
      `UPDATE service_manifests
       SET superseded_at = NOW(),
           updated_at = NOW()
       WHERE module_id = $1 AND superseded_at IS NULL`,
      [normalizedModuleId]
    );

    for (const entry of entries) {
      const slug = entry.serviceSlug.trim().toLowerCase();
      if (!slug) {
        continue;
      }
      await client.query(
        `INSERT INTO service_manifests (
           module_id,
           module_version,
           service_slug,
           definition,
           checksum,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())`,
        [normalizedModuleId, nextVersion, slug, serializeDefinition(entry.definition), entry.checksum]
      );
    }

    return nextVersion;
  });
}

export async function listActiveServiceManifests(): Promise<ServiceManifestStoreRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceManifestRow>(
      `SELECT *
       FROM service_manifests
       WHERE superseded_at IS NULL
       ORDER BY service_slug ASC`
    );
    return rows.map(mapServiceManifestRow);
  });
}

export async function listActiveServiceManifestsBySlug(
  slug: string
): Promise<ServiceManifestStoreRecord[]> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return [];
  }
  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceManifestRow>(
      `SELECT *
       FROM service_manifests
       WHERE service_slug = $1 AND superseded_at IS NULL
       ORDER BY module_id ASC, module_version DESC`,
      [normalizedSlug]
    );
    return rows.map(mapServiceManifestRow);
  });
}

export async function listActiveServiceManifestsByModule(
  moduleId: string
): Promise<ServiceManifestStoreRecord[]> {
  const normalizedModuleId = moduleId.trim();
  if (!normalizedModuleId) {
    return [];
  }

  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceManifestRow>(
      `SELECT *
       FROM service_manifests
       WHERE module_id = $1 AND superseded_at IS NULL
       ORDER BY service_slug ASC`,
      [normalizedModuleId]
    );
    return rows.map(mapServiceManifestRow);
  });
}
