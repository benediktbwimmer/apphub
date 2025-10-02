import type { StorageTargetRecord } from '../db/metadata';

type PartitionTime = string | Date | null | undefined;

export interface PartitionAccessContext {
  datasetSlug: string;
  partitionId: string;
  storageTarget: StorageTargetRecord;
  location: string;
  startTime?: PartitionTime;
  endTime?: PartitionTime;
}

export interface PartitionAccessAssessment {
  recoverable: boolean;
  warning?: string;
  error: Error;
}

export function assessPartitionAccessError(
  context: PartitionAccessContext,
  rawError: unknown
): PartitionAccessAssessment {
  const error = normalizeError(rawError);
  const message = error.message.toLowerCase();

  if (isMissingObjectError(message, error)) {
    const warning = buildMissingObjectWarning(context);
    return {
      recoverable: true,
      warning,
      error
    } satisfies PartitionAccessAssessment;
  }

  return {
    recoverable: false,
    error
  } satisfies PartitionAccessAssessment;
}

export function isMissingStorageObjectError(rawError: unknown): boolean {
  const error = normalizeError(rawError);
  return isMissingObjectError(error.message.toLowerCase(), error);
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const message = error === null || error === undefined ? 'Unknown error' : String(error);
  return new Error(message);
}

function isMissingObjectError(message: string, error: Error): boolean {
  if (!message) {
    return false;
  }

  if (message.includes('http error') && (message.includes('404') || message.includes('not found'))) {
    return true;
  }

  if (message.includes('no such key') || message.includes('key does not exist')) {
    return true;
  }

  if (message.includes('no such file') || message.includes('file does not exist')) {
    return true;
  }

  if (message.includes('path does not exist') || message.includes('unable to open file')) {
    return true;
  }

  if (message.includes('no files found')) {
    return true;
  }

  const code = (error as { code?: string }).code;
  if (typeof code === 'string' && code.toLowerCase() === 'nosuchkey') {
    return true;
  }

  return false;
}

function buildMissingObjectWarning(context: PartitionAccessContext): string {
  const targetLabel = context.storageTarget.name || context.storageTarget.id;
  const range = formatRange(context.startTime, context.endTime);
  const segments = [
    `Skipped partition ${context.partitionId} from dataset ${context.datasetSlug}`,
    `storage target ${targetLabel} (${context.storageTarget.kind})`
  ];
  if (range) {
    segments.push(`window ${range}`);
  }
  segments.push(`object not found at ${context.location}`);
  return `${segments.join('; ')}.`;
}

function formatRange(start: PartitionTime, end: PartitionTime): string | null {
  const startIso = toIso(start);
  const endIso = toIso(end);
  if (!startIso && !endIso) {
    return null;
  }
  if (startIso && endIso) {
    return `${startIso} – ${endIso}`;
  }
  return startIso ?? endIso;
}

function toIso(input: PartitionTime): string | null {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    return input;
  }
  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
}
