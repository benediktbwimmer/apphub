import { useConnection, useTransaction } from './utils';
import { type ResolvedManifestEnvVar } from '../serviceManifestTypes';
import {
  type ServiceNetworkRecord,
  type ServiceNetworkMemberInput,
  type ServiceNetworkLaunchMemberInput,
  type ServiceNetworkLaunchMemberRecord,
  type JsonValue
} from './types';
import {
  mapServiceNetworkLaunchMemberRow,
  mapServiceNetworkMemberRow,
  mapServiceNetworkRow
} from './rowMappers';
import type {
  ServiceNetworkLaunchMemberRow,
  ServiceNetworkMemberRow,
  ServiceNetworkRow
} from './rowTypes';

function serializeManifestEnv(entries: ResolvedManifestEnvVar[] | undefined): string {
  if (!entries || entries.length === 0) {
    return '[]';
  }
  const serialized = entries
    .filter((entry) => Boolean(entry && typeof entry.key === 'string'))
    .map((entry) => {
      const key = entry.key.trim();
      if (!key) {
        return null;
      }
      const clone: Record<string, unknown> = { key };
      if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
        clone.value = entry.value ?? null;
      }
      if (entry.fromService) {
        clone.fromService = {
          service: entry.fromService.service,
          property: entry.fromService.property,
          fallback: entry.fromService.fallback
        };
      }
      return clone;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return JSON.stringify(serialized);
}

function serializeDependsOn(dependsOn: string[] | undefined): string {
  if (!dependsOn || dependsOn.length === 0) {
    return '[]';
  }
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of dependsOn) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
  }
  return JSON.stringify(values);
}

async function fetchServiceNetwork(
  client: import('pg').PoolClient,
  repositoryId: string
): Promise<ServiceNetworkRecord | null> {
  const { rows } = await client.query<ServiceNetworkRow>(
    'SELECT * FROM service_networks WHERE repository_id = $1',
    [repositoryId]
  );
  if (rows.length === 0) {
    return null;
  }
  const { rows: memberRows } = await client.query<ServiceNetworkMemberRow>(
    `SELECT *
     FROM service_network_members
     WHERE network_repository_id = $1
     ORDER BY launch_order ASC, member_repository_id ASC`,
    [repositoryId]
  );
  return mapServiceNetworkRow(rows[0], memberRows);
}

export async function upsertServiceNetwork(
  input: {
    repositoryId: string;
    manifestSource?: string | null;
    moduleId?: string | null;
    moduleVersion?: number | null;
    definition?: JsonValue | null;
    checksum?: string | null;
  }
): Promise<ServiceNetworkRecord> {
  const manifestSource = input.manifestSource ?? null;
  const moduleId = input.moduleId ?? null;
  const moduleVersion = input.moduleVersion ?? null;
  const definition = input.definition ?? null;
  const checksum = input.checksum ?? null;
  await useTransaction(async (client) => {
    await client.query(
      `INSERT INTO service_networks (
         repository_id,
         manifest_source,
         module_id,
         module_version,
         version,
         definition,
         checksum,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, NOW(), NOW())
       ON CONFLICT (repository_id) DO UPDATE SET
         manifest_source = EXCLUDED.manifest_source,
         module_id = EXCLUDED.module_id,
         module_version = EXCLUDED.module_version,
         definition = EXCLUDED.definition,
         checksum = EXCLUDED.checksum,
         version = service_networks.version + 1,
         updated_at = NOW()`,
      [
        input.repositoryId,
        manifestSource,
        moduleId,
        moduleVersion,
        definition === null ? null : JSON.stringify(definition),
        checksum
      ]
    );
  });

  const network = await useConnection((client) => fetchServiceNetwork(client, input.repositoryId));
  if (!network) {
    throw new Error('failed to upsert service network');
  }
  return network;
}

export async function replaceServiceNetworkMembers(
  networkRepositoryId: string,
  members: ServiceNetworkMemberInput[]
): Promise<ServiceNetworkRecord | null> {
  await useTransaction(async (client) => {
    const { rows } = await client.query<ServiceNetworkRow>(
      'SELECT * FROM service_networks WHERE repository_id = $1 FOR UPDATE',
      [networkRepositoryId]
    );
    if (rows.length === 0) {
      return;
    }
    await client.query('DELETE FROM service_network_members WHERE network_repository_id = $1', [networkRepositoryId]);
    let fallbackOrder = 0;
    for (const member of members) {
      if (!member || typeof member.memberRepositoryId !== 'string') {
        continue;
      }
      const memberId = member.memberRepositoryId.trim().toLowerCase();
      if (!memberId) {
        continue;
      }
      const providedOrder = Number(member.launchOrder);
      const launchOrder = Number.isFinite(providedOrder) && providedOrder >= 0 ? providedOrder : fallbackOrder;
      await client.query(
        `INSERT INTO service_network_members (
           network_repository_id,
           member_repository_id,
           launch_order,
           wait_for_build,
           env_vars,
           depends_on,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())`,
        [
          networkRepositoryId,
          memberId,
          launchOrder,
          member.waitForBuild === false ? false : true,
          serializeManifestEnv(member.env),
          serializeDependsOn(member.dependsOn)
        ]
      );
      fallbackOrder += 1;
    }
    await client.query('UPDATE service_networks SET updated_at = NOW() WHERE repository_id = $1', [networkRepositoryId]);
  });

  return useConnection((client) => fetchServiceNetwork(client, networkRepositoryId));
}

export async function getServiceNetworkByRepositoryId(
  repositoryId: string
): Promise<ServiceNetworkRecord | null> {
  return useConnection((client) => fetchServiceNetwork(client, repositoryId));
}

export async function deleteServiceNetwork(repositoryId: string): Promise<void> {
  await useTransaction(async (client) => {
    await client.query('DELETE FROM service_network_members WHERE network_repository_id = $1', [repositoryId]);
    await client.query('DELETE FROM service_networks WHERE repository_id = $1', [repositoryId]);
  });
}

export async function listServiceNetworkRepositoryIds(): Promise<string[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<{ repository_id: string }>(
      'SELECT repository_id FROM service_networks ORDER BY repository_id ASC'
    );
    return rows.map((row) => row.repository_id);
  });
}

export async function listAllServiceNetworks(): Promise<ServiceNetworkRecord[]> {
  return useConnection(async (client) => {
    const { rows: networkRows } = await client.query<ServiceNetworkRow>(
      'SELECT * FROM service_networks ORDER BY repository_id ASC'
    );
    if (networkRows.length === 0) {
      return [];
    }

    const networkIds = networkRows.map((row) => row.repository_id);
    const { rows: memberRows } = await client.query<ServiceNetworkMemberRow>(
      `SELECT *
       FROM service_network_members
       WHERE network_repository_id = ANY($1)
       ORDER BY network_repository_id ASC, launch_order ASC, member_repository_id ASC`,
      [networkIds]
    );

    const membersByNetwork = new Map<string, ServiceNetworkMemberRow[]>();
    for (const member of memberRows) {
      const current = membersByNetwork.get(member.network_repository_id);
      if (current) {
        current.push(member);
      } else {
        membersByNetwork.set(member.network_repository_id, [member]);
      }
    }

    return networkRows.map((row) =>
      mapServiceNetworkRow(row, membersByNetwork.get(row.repository_id) ?? [])
    );
  });
}

export async function listServiceNetworksByModule(
  moduleId: string
): Promise<ServiceNetworkRecord[]> {
  const normalizedModuleId = moduleId.trim();
  if (!normalizedModuleId) {
    return [];
  }

  return useConnection(async (client) => {
    const { rows: networkRows } = await client.query<ServiceNetworkRow>(
      'SELECT * FROM service_networks WHERE module_id = $1 ORDER BY repository_id ASC',
      [normalizedModuleId]
    );
    if (networkRows.length === 0) {
      return [];
    }
    const ids = networkRows.map((row) => row.repository_id);
    const { rows: memberRows } = await client.query<ServiceNetworkMemberRow>(
      `SELECT *
       FROM service_network_members
       WHERE network_repository_id = ANY($1)
       ORDER BY network_repository_id ASC, launch_order ASC, member_repository_id ASC`,
      [ids]
    );
    const membersByNetwork = new Map<string, ServiceNetworkMemberRow[]>();
    for (const member of memberRows) {
      const current = membersByNetwork.get(member.network_repository_id);
      if (current) {
        current.push(member);
      } else {
        membersByNetwork.set(member.network_repository_id, [member]);
      }
    }
    return networkRows.map((row) =>
      mapServiceNetworkRow(row, membersByNetwork.get(row.repository_id) ?? [])
    );
  });
}

export async function isServiceNetworkRepository(repositoryId: string): Promise<boolean> {
  return useConnection(async (client) => {
    const { rows } = await client.query('SELECT 1 FROM service_networks WHERE repository_id = $1', [repositoryId]);
    return rows.length > 0;
  });
}

export async function listNetworksForMemberRepository(memberRepositoryId: string): Promise<string[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<{ network_repository_id: string }>(
      `SELECT network_repository_id
       FROM service_network_members
       WHERE member_repository_id = $1`,
      [memberRepositoryId.trim().toLowerCase()]
    );
    return rows.map((row) => row.network_repository_id);
  });
}

export async function recordServiceNetworkLaunchMembers(
  networkLaunchId: string,
  members: ServiceNetworkLaunchMemberInput[]
): Promise<void> {
  await useTransaction(async (client) => {
    await client.query('DELETE FROM service_network_launch_members WHERE network_launch_id = $1', [networkLaunchId]);
    for (const member of members) {
      if (!member || typeof member.memberLaunchId !== 'string') {
        continue;
      }
      await client.query(
        `INSERT INTO service_network_launch_members (
           network_launch_id,
           member_launch_id,
           member_repository_id,
           launch_order,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [networkLaunchId, member.memberLaunchId, member.memberRepositoryId, member.launchOrder]
      );
    }
  });
}

export async function getServiceNetworkLaunchMembers(
  networkLaunchId: string
): Promise<ServiceNetworkLaunchMemberRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ServiceNetworkLaunchMemberRow>(
      `SELECT * FROM service_network_launch_members
       WHERE network_launch_id = $1
       ORDER BY launch_order ASC, member_repository_id ASC`,
      [networkLaunchId]
    );
    return rows.map(mapServiceNetworkLaunchMemberRow);
  });
}

export async function deleteServiceNetworkLaunchMembers(networkLaunchId: string): Promise<void> {
  await useTransaction(async (client) => {
    await client.query('DELETE FROM service_network_launch_members WHERE network_launch_id = $1', [networkLaunchId]);
  });
}
