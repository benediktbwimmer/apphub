import { useConnection } from './utils';

export type ModulePublishStatusRow = {
  module_id: string;
  workspace_path: string | null;
  workspace_name: string | null;
  stage: string;
  state: string;
  job_id: string | null;
  message: string | null;
  error: string | null;
  logs: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ModulePublishStatusRecord = {
  moduleId: string;
  workspacePath: string | null;
  workspaceName: string | null;
  stage: string;
  state: string;
  jobId: string | null;
  message: string | null;
  error: string | null;
  logs: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModulePublishStatusUpsertInput = {
  moduleId: string;
  workspacePath?: string | null;
  workspaceName?: string | null;
  stage: string;
  state: string;
  jobId?: string | null;
  message?: string | null;
  error?: string | null;
  logs?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

function mapRow(row: ModulePublishStatusRow): ModulePublishStatusRecord {
  return {
    moduleId: row.module_id,
    workspacePath: row.workspace_path,
    workspaceName: row.workspace_name,
    stage: row.stage,
    state: row.state,
    jobId: row.job_id,
    message: row.message,
    error: row.error,
    logs: row.logs,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ModulePublishStatusRecord;
}

export async function listModulePublishStatuses(): Promise<ModulePublishStatusRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ModulePublishStatusRow>(
      'SELECT * FROM module_publish_status ORDER BY updated_at DESC'
    );
    return rows.map(mapRow);
  });
}

export async function getModulePublishStatus(moduleId: string): Promise<ModulePublishStatusRecord | null> {
  const normalized = moduleId.trim();
  if (!normalized) {
    return null;
  }
  return useConnection(async (client) => {
    const { rows } = await client.query<ModulePublishStatusRow>(
      'SELECT * FROM module_publish_status WHERE module_id = $1 LIMIT 1',
      [normalized]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapRow(rows[0]!);
  });
}

export async function upsertModulePublishStatus(
  input: ModulePublishStatusUpsertInput
): Promise<ModulePublishStatusRecord> {
  const normalizedId = input.moduleId.trim();
  if (!normalizedId) {
    throw new Error('moduleId is required');
  }
  return useConnection(async (client) => {
    const { rows } = await client.query<ModulePublishStatusRow>(
      `INSERT INTO module_publish_status (
         module_id,
         workspace_path,
         workspace_name,
         stage,
         state,
         job_id,
         message,
         error,
         logs,
         started_at,
         completed_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         COALESCE($10, NOW()),
         $11,
         NOW()
       )
       ON CONFLICT (module_id)
       DO UPDATE SET
         workspace_path = COALESCE(EXCLUDED.workspace_path, module_publish_status.workspace_path),
         workspace_name = COALESCE(EXCLUDED.workspace_name, module_publish_status.workspace_name),
         stage = EXCLUDED.stage,
         state = EXCLUDED.state,
         job_id = COALESCE(EXCLUDED.job_id, module_publish_status.job_id),
         message = COALESCE(EXCLUDED.message, module_publish_status.message),
         error = EXCLUDED.error,
         logs = COALESCE(EXCLUDED.logs, module_publish_status.logs),
         started_at = COALESCE(EXCLUDED.started_at, module_publish_status.started_at),
         completed_at = EXCLUDED.completed_at,
         updated_at = NOW()
       RETURNING *`,
      [
        normalizedId,
        input.workspacePath ?? null,
        input.workspaceName ?? null,
        input.stage,
        input.state,
        input.jobId ?? null,
        input.message ?? null,
        input.error ?? null,
        input.logs ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null
      ]
    );
    return mapRow(rows[0]!);
  });
}

export async function clearModulePublishStatus(moduleId: string): Promise<void> {
  const normalized = moduleId.trim();
  if (!normalized) {
    return;
  }
  await useConnection((client) =>
    client.query('DELETE FROM module_publish_status WHERE module_id = $1', [normalized])
  );
}
