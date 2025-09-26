import { bulkRequestSchema, type BulkRequestPayload, type MetastoreRecordDetail } from './types';

export type CrossLinks = {
  datasetSlug?: string;
  assetId?: string;
};

export function formatInstant(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function stringifyMetadata(metadata: unknown): string {
  try {
    return JSON.stringify(metadata ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

export function parseMetadataInput(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Metadata must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to parse metadata JSON');
  }
}

export function parseTagsInput(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function prepareBulkPayload(raw: string, continueOnError: boolean): BulkRequestPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Provide JSON payload for bulk operations.');
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(trimmed) as unknown;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Bulk payload must be valid JSON');
  }

  let payload: BulkRequestPayload;
  if (Array.isArray(candidate)) {
    payload = { operations: candidate as unknown[], continueOnError } as BulkRequestPayload;
  } else if (candidate && typeof candidate === 'object' && 'operations' in (candidate as Record<string, unknown>)) {
    payload = {
      ...(candidate as Record<string, unknown>),
      continueOnError
    } as BulkRequestPayload;
  } else {
    throw new Error('Bulk payload must be an array of operations or an object with an "operations" array.');
  }

  return bulkRequestSchema.parse(payload);
}

export function extractCrossLinks(record: MetastoreRecordDetail | null): CrossLinks {
  if (!record || !record.metadata || typeof record.metadata !== 'object') {
    return {};
  }
  const metadata = record.metadata as Record<string, unknown>;
  const datasetSlug = typeof metadata.datasetSlug === 'string' ? metadata.datasetSlug : undefined;
  const assetId = typeof metadata.assetId === 'string' ? metadata.assetId : undefined;
  return { datasetSlug, assetId };
}

export function mapMetastoreError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || 'Unexpected metastore error';
    if (/version/i.test(message) || /409/.test(message)) {
      return `${message}. Refresh the record to obtain the latest version before retrying.`;
    }
    return message;
  }
  return 'Unexpected metastore error';
}
