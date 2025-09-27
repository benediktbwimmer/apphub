import type { PoolClient } from 'pg';

export type BackendMountRecord = {
  id: number;
  mountKey: string;
  backendKind: 'local' | 's3';
  rootPath: string | null;
  bucket: string | null;
  prefix: string | null;
  config: Record<string, unknown>;
  accessMode: 'rw' | 'ro';
  state: string;
};

type BackendMountRow = {
  id: number;
  mount_key: string;
  backend_kind: 'local' | 's3';
  root_path: string | null;
  bucket: string | null;
  prefix: string | null;
  config: Record<string, unknown> | null;
  access_mode: 'rw' | 'ro';
  state: string;
};

function mapBackendMountRow(row: BackendMountRow): BackendMountRecord {
  return {
    id: row.id,
    mountKey: row.mount_key,
    backendKind: row.backend_kind,
    rootPath: row.root_path,
    bucket: row.bucket,
    prefix: row.prefix,
    config: row.config ?? {},
    accessMode: row.access_mode,
    state: row.state
  };
}

export async function getBackendMountById(
  client: PoolClient,
  id: number,
  options: { forUpdate?: boolean } = {}
): Promise<BackendMountRecord | null> {
  const lock = options.forUpdate === false ? '' : ' FOR UPDATE';
  const result = await client.query<BackendMountRow>(
    `SELECT id, mount_key, backend_kind, root_path, bucket, prefix, config, access_mode, state
       FROM backend_mounts
      WHERE id = $1${lock}`,
    [id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapBackendMountRow(result.rows[0]);
}

export async function listBackendMounts(client: PoolClient): Promise<BackendMountRecord[]> {
  const result = await client.query<BackendMountRow>(
    `SELECT id, mount_key, backend_kind, root_path, bucket, prefix, config, access_mode, state
       FROM backend_mounts
      ORDER BY id`
  );

  return result.rows.map(mapBackendMountRow);
}

export async function getBackendMountsByIds(
  client: PoolClient,
  ids: readonly number[]
): Promise<Map<number, BackendMountRecord>> {
  if (ids.length === 0) {
    return new Map();
  }

  const result = await client.query<BackendMountRow>(
    `SELECT id, mount_key, backend_kind, root_path, bucket, prefix, config, access_mode, state
       FROM backend_mounts
      WHERE id = ANY($1::int[])`,
    [ids]
  );

  const map = new Map<number, BackendMountRecord>();
  for (const row of result.rows) {
    const record = mapBackendMountRow(row);
    map.set(record.id, record);
  }
  return map;
}
