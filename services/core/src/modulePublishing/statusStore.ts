import {
  clearModulePublishStatus as deleteStatus,
  getModulePublishStatus as fetchStatus,
  listModulePublishStatuses as fetchStatuses,
  upsertModulePublishStatus
} from '../db/modulePublishes';
import type { ModulePublishStatusRecord } from '../db/modulePublishes';
import { stageToState, type ModulePublishStage } from './types';

export type ModulePublishStatus = {
  moduleId: string;
  workspacePath: string | null;
  workspaceName: string | null;
  stage: ModulePublishStage;
  state: 'queued' | 'running' | 'completed' | 'failed';
  jobId: string | null;
  message: string | null;
  error: string | null;
  logs: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function recordProgress(
  moduleId: string,
  stage: ModulePublishStage,
  options: {
    workspacePath?: string | null;
    workspaceName?: string | null;
    jobId?: string | null;
    message?: string | null;
    error?: string | null;
    logs?: string | null;
    startedAt?: string | null;
  } = {}
): Promise<ModulePublishStatus> {
  const record = await upsertModulePublishStatus({
    moduleId,
    workspacePath: options.workspacePath ?? null,
    workspaceName: options.workspaceName ?? null,
    stage,
    state: stageToState(stage),
    jobId: options.jobId ?? null,
    message: options.message ?? null,
    error: options.error ?? null,
    logs: options.logs ?? null,
    startedAt: options.startedAt ?? null,
    completedAt: stage === 'completed' ? new Date().toISOString() : null
  });
  return mapRecord(record);
}

export async function recordCompletion(
  moduleId: string,
  options: {
    workspacePath?: string | null;
    workspaceName?: string | null;
    jobId?: string | null;
    message?: string | null;
    logs?: string | null;
  } = {}
): Promise<ModulePublishStatus> {
  const record = await upsertModulePublishStatus({
    moduleId,
    workspacePath: options.workspacePath ?? null,
    workspaceName: options.workspaceName ?? null,
    stage: 'completed',
    state: 'completed',
    jobId: options.jobId ?? null,
    message: options.message ?? null,
    error: null,
    logs: options.logs ?? null,
    completedAt: new Date().toISOString()
  });
  return mapRecord(record);
}

export async function recordFailure(
  moduleId: string,
  error: string,
  options: {
    workspacePath?: string | null;
    workspaceName?: string | null;
    jobId?: string | null;
    message?: string | null;
    logs?: string | null;
  } = {}
): Promise<ModulePublishStatus> {
  const record = await upsertModulePublishStatus({
    moduleId,
    workspacePath: options.workspacePath ?? null,
    workspaceName: options.workspaceName ?? null,
    stage: 'failed',
    state: 'failed',
    jobId: options.jobId ?? null,
    message: options.message ?? null,
    error,
    logs: options.logs ?? null,
    completedAt: new Date().toISOString()
  });
  return mapRecord(record);
}

export async function listStatuses(): Promise<ModulePublishStatus[]> {
  const records = await fetchStatuses();
  return records.map(mapRecord);
}

export async function getStatus(moduleId: string): Promise<ModulePublishStatus | null> {
  const record = await fetchStatus(moduleId);
  return record ? mapRecord(record) : null;
}

export async function clearStatus(moduleId: string): Promise<void> {
  await deleteStatus(moduleId);
}

function mapRecord(record: ModulePublishStatusRecord): ModulePublishStatus {
  return {
    moduleId: record.moduleId,
    workspacePath: record.workspacePath,
    workspaceName: record.workspaceName,
    stage: record.stage as ModulePublishStage,
    state: record.state as ModulePublishStatus['state'],
    jobId: record.jobId,
    message: record.message,
    error: record.error,
    logs: record.logs,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  } satisfies ModulePublishStatus;
}
