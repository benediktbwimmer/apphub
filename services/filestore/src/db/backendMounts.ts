import type { PoolClient } from 'pg';

export type BackendMountRecord = {
  id: number;
  mountKey: string;
  displayName: string | null;
  description: string | null;
  contact: string | null;
  labels: string[];
  backendKind: 'local' | 's3';
  rootPath: string | null;
  bucket: string | null;
  prefix: string | null;
  config: Record<string, unknown>;
  accessMode: 'rw' | 'ro';
  state: string;
  stateReason: string | null;
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BackendMountRow = {
  id: number;
  mount_key: string;
  display_name: string | null;
  description: string | null;
  contact: string | null;
  labels: string[] | null;
  backend_kind: 'local' | 's3';
  root_path: string | null;
  bucket: string | null;
  prefix: string | null;
  config: Record<string, unknown> | null;
  access_mode: 'rw' | 'ro';
  state: string;
  state_reason: string | null;
  last_health_check_at: Date | null;
  last_health_status: string | null;
  created_at: Date;
  updated_at: Date;
};

type BackendMountRowWithTotal = BackendMountRow & { total_count: number | string };

export type ListBackendMountsOptions = {
  limit: number;
  offset: number;
  kinds?: Array<'local' | 's3'>;
  states?: string[];
  accessModes?: Array<'rw' | 'ro'>;
  search?: string | null;
};

export type ListBackendMountsResult = {
  mounts: BackendMountRecord[];
  total: number;
};

export type CreateBackendMountInput = {
  mountKey: string;
  backendKind: 'local' | 's3';
  rootPath?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  accessMode: 'rw' | 'ro';
  state: string;
  displayName?: string | null;
  description?: string | null;
  contact?: string | null;
  labels?: string[];
  stateReason?: string | null;
  config?: Record<string, unknown>;
};

export type UpdateBackendMountInput = {
  mountKey?: string;
  rootPath?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  accessMode?: 'rw' | 'ro';
  state?: string;
  displayName?: string | null;
  description?: string | null;
  contact?: string | null;
  labels?: string[];
  stateReason?: string | null;
  config?: Record<string, unknown> | null;
};

function sanitizeLabels(labels: string[] | undefined): string[] {
  if (!labels || labels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string') {
      continue;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.length > 64) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function mapBackendMountRow(row: BackendMountRow): BackendMountRecord {
  return {
    id: row.id,
    mountKey: row.mount_key,
    displayName: row.display_name,
    description: row.description,
    contact: row.contact,
    labels: Array.isArray(row.labels) ? row.labels : [],
    backendKind: row.backend_kind,
    rootPath: row.root_path,
    bucket: row.bucket,
    prefix: row.prefix,
    config: row.config ?? {},
    accessMode: row.access_mode,
    state: row.state,
    stateReason: row.state_reason,
    lastHealthCheckAt: row.last_health_check_at,
    lastHealthStatus: row.last_health_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getBackendMountById(
  client: PoolClient,
  id: number,
  options: { forUpdate?: boolean } = {}
): Promise<BackendMountRecord | null> {
  const lockClause = options.forUpdate === false ? '' : ' FOR UPDATE';
  const result = await client.query<BackendMountRow>(
    `SELECT
        id,
        mount_key,
        display_name,
        description,
        contact,
        labels,
        backend_kind,
        root_path,
        bucket,
        prefix,
        config,
        access_mode,
        state,
        state_reason,
        last_health_check_at,
        last_health_status,
        created_at,
        updated_at
       FROM backend_mounts
      WHERE id = $1${lockClause}`,
    [id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapBackendMountRow(result.rows[0]);
}

export async function listBackendMounts(
  client: PoolClient,
  options: ListBackendMountsOptions
): Promise<ListBackendMountsResult> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (options.kinds && options.kinds.length > 0) {
    conditions.push(`backend_kind = ANY($${index}::text[])`);
    values.push(options.kinds);
    index += 1;
  }

  if (options.states && options.states.length > 0) {
    conditions.push(`state = ANY($${index}::text[])`);
    values.push(options.states);
    index += 1;
  }

  if (options.accessModes && options.accessModes.length > 0) {
    conditions.push(`access_mode = ANY($${index}::text[])`);
    values.push(options.accessModes);
    index += 1;
  }

  if (options.search && options.search.trim().length > 0) {
    const sanitized = options.search.trim().replace(/[\\%_]/g, (match) => `\\${match}`);
    const pattern = `%${sanitized}%`;
    conditions.push(
      `(
         mount_key ILIKE $${index}
         OR display_name ILIKE $${index}
         OR COALESCE(bucket, '') ILIKE $${index}
         OR COALESCE(root_path, '') ILIKE $${index}
       )`
    );
    values.push(pattern);
    index += 1;
  }

  const limitParam = index;
  const offsetParam = index + 1;

  values.push(options.limit);
  values.push(options.offset);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      id,
      mount_key,
      display_name,
      description,
      contact,
      labels,
      backend_kind,
      root_path,
      bucket,
      prefix,
      config,
      access_mode,
      state,
      state_reason,
      last_health_check_at,
      last_health_status,
      created_at,
      updated_at,
      COUNT(*) OVER() AS total_count
    FROM backend_mounts
    ${whereClause}
    ORDER BY COALESCE(display_name, mount_key), id
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const result = await client.query<BackendMountRowWithTotal>(query, values);
  const total = result.rows.length > 0 ? Number(result.rows[0].total_count ?? 0) : 0;

  return {
    mounts: result.rows.map(mapBackendMountRow),
    total
  };
}

export async function createBackendMount(
  client: PoolClient,
  input: CreateBackendMountInput
): Promise<BackendMountRecord> {
  const result = await client.query<BackendMountRow>(
    `INSERT INTO backend_mounts (
       mount_key,
       backend_kind,
       root_path,
       bucket,
       prefix,
       config,
       access_mode,
       state,
       state_reason,
       display_name,
       description,
       contact,
       labels
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
     RETURNING
       id,
       mount_key,
       display_name,
       description,
       contact,
       labels,
       backend_kind,
       root_path,
       bucket,
       prefix,
       config,
       access_mode,
       state,
       state_reason,
       last_health_check_at,
       last_health_status,
       created_at,
       updated_at`,
    [
      input.mountKey,
      input.backendKind,
      input.rootPath ?? null,
      input.bucket ?? null,
      input.prefix ?? null,
      JSON.stringify(input.config ?? {}),
      input.accessMode,
      input.state,
      input.stateReason ?? null,
      input.displayName ?? null,
      input.description ?? null,
      input.contact ?? null,
      sanitizeLabels(input.labels)
    ]
  );

  return mapBackendMountRow(result.rows[0]);
}

export async function updateBackendMount(
  client: PoolClient,
  id: number,
  input: UpdateBackendMountInput
): Promise<BackendMountRecord | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const pushAssignment = (column: string, value: unknown) => {
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (input.mountKey !== undefined) {
    pushAssignment('mount_key', input.mountKey);
  }
  if (input.rootPath !== undefined) {
    pushAssignment('root_path', input.rootPath);
  }
  if (input.bucket !== undefined) {
    pushAssignment('bucket', input.bucket);
  }
  if (input.prefix !== undefined) {
    pushAssignment('prefix', input.prefix);
  }
  if (input.accessMode !== undefined) {
    pushAssignment('access_mode', input.accessMode);
  }
  if (input.state !== undefined) {
    pushAssignment('state', input.state);
  }
  if (input.stateReason !== undefined) {
    pushAssignment('state_reason', input.stateReason);
  }
  if (input.displayName !== undefined) {
    pushAssignment('display_name', input.displayName);
  }
  if (input.description !== undefined) {
    pushAssignment('description', input.description);
  }
  if (input.contact !== undefined) {
    pushAssignment('contact', input.contact);
  }
  if (input.labels !== undefined) {
    pushAssignment('labels', sanitizeLabels(input.labels));
  }
  if (input.config !== undefined) {
    pushAssignment('config', JSON.stringify(input.config ?? {}));
  }

  if (assignments.length === 0) {
    return getBackendMountById(client, id, { forUpdate: false });
  }

  assignments.push('updated_at = NOW()');
  const query = `
    UPDATE backend_mounts
       SET ${assignments.join(', ')}
     WHERE id = $${index}
     RETURNING
       id,
       mount_key,
       display_name,
       description,
       contact,
       labels,
       backend_kind,
       root_path,
       bucket,
       prefix,
       config,
       access_mode,
       state,
       state_reason,
       last_health_check_at,
       last_health_status,
       created_at,
       updated_at`;

  values.push(id);

  const result = await client.query<BackendMountRow>(query, values);
  const rowCount = result.rowCount ?? 0;
  if (rowCount === 0) {
    return null;
  }
  return mapBackendMountRow(result.rows[0]);
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
