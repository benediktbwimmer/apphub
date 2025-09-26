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

export async function getBackendMountById(client: PoolClient, id: number): Promise<BackendMountRecord | null> {
  const result = await client.query<{
    id: number;
    mount_key: string;
    backend_kind: 'local' | 's3';
    root_path: string | null;
    bucket: string | null;
    prefix: string | null;
    config: Record<string, unknown> | null;
    access_mode: 'rw' | 'ro';
    state: string;
  }>(
    `SELECT id, mount_key, backend_kind, root_path, bucket, prefix, config, access_mode, state
       FROM backend_mounts
      WHERE id = $1
      FOR UPDATE`,
    [id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
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
