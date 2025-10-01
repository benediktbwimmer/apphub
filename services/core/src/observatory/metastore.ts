import { getObservatoryCalibrationConfig } from '../config/observatory';
import type { CalibrationPlanRecordSummary, CalibrationSnapshot } from './calibrationTypes';
import { parseCalibrationPlanSummary, parseCalibrationSnapshot, parseCalibrationSnapshots } from './calibrationTypes';

const DEFAULT_CALIBRATION_LIMIT = 50;
const DEFAULT_PLAN_LIMIT = 25;

type MetastoreSearchResponse = {
  records?: Array<Record<string, unknown>>;
};

type MetastoreGetResponse = {
  record?: { metadata?: unknown; version?: number | null } | null;
};

type MetastoreSearchOptions = {
  limit?: number;
  instrumentId?: string;
};

type PlanSearchOptions = {
  limit?: number;
};

function buildHeaders(token: string | null, userAgent: string): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': userAgent
  });
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return headers;
}

function buildBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse metastore response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listCalibrationSnapshots(options: MetastoreSearchOptions = {}): Promise<CalibrationSnapshot[]> {
  const config = await getObservatoryCalibrationConfig();
  const runtime = config.metastore.runtime;
  const namespace = config.metastore.calibrationNamespace;
  const baseUrl = buildBaseUrl(runtime.baseUrl);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_CALIBRATION_LIMIT, 1), 200);
  const headers = buildHeaders(runtime.token, runtime.userAgent);

  const filter = options.instrumentId
    ? {
        field: 'metadata.instrumentId',
        operator: 'eq',
        value: options.instrumentId.trim()
      }
    : undefined;

  const body: Record<string, unknown> = {
    namespace,
    limit,
    sort: [
      { field: 'metadata.effectiveAt', direction: 'desc' },
      { field: 'version', direction: 'desc' }
    ]
  };
  if (filter) {
    body.filter = filter;
  }

  const response = await fetch(`${baseUrl}/records/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to list calibrations: ${response.status} ${detail}`);
  }

  const payload = await readJson<MetastoreSearchResponse>(response);
  return parseCalibrationSnapshots(payload.records ?? []);
}

export async function getCalibrationSnapshot(calibrationId: string): Promise<CalibrationSnapshot | null> {
  const config = await getObservatoryCalibrationConfig();
  const runtime = config.metastore.runtime;
  const namespace = config.metastore.calibrationNamespace;
  const trimmedId = calibrationId.trim();
  if (!trimmedId) {
    return null;
  }
  const headers = buildHeaders(runtime.token, runtime.userAgent);
  const baseUrl = buildBaseUrl(runtime.baseUrl);

  const response = await fetch(
    `${baseUrl}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(trimmedId)}`,
    {
      method: 'GET',
      headers
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to load calibration ${trimmedId}: ${response.status} ${detail}`);
  }

  const payload = await readJson<MetastoreGetResponse>(response);
  const snapshot = parseCalibrationSnapshot({
    key: trimmedId,
    version: payload.record?.version ?? null,
    metadata: payload.record?.metadata ?? null
  });
  return snapshot;
}

export async function listCalibrationPlans(options: PlanSearchOptions = {}): Promise<CalibrationPlanRecordSummary[]> {
  const config = await getObservatoryCalibrationConfig();
  const runtime = config.metastore.runtime;
  const namespace = config.metastore.planNamespace;
  const baseUrl = buildBaseUrl(runtime.baseUrl);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PLAN_LIMIT, 1), 100);
  const headers = buildHeaders(runtime.token, runtime.userAgent);

  const response = await fetch(`${baseUrl}/records/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      namespace,
      limit,
      sort: [
        { field: 'metadata.updatedAt', direction: 'desc' },
        { field: 'version', direction: 'desc' }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to list calibration plans: ${response.status} ${detail}`);
  }

  const payload = await readJson<MetastoreSearchResponse>(response);
  const entries = payload.records ?? [];
  const summaries: CalibrationPlanRecordSummary[] = [];
  for (const entry of entries) {
    const summary = parseCalibrationPlanSummary(entry.metadata ?? entry);
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries;
}

export async function getCalibrationPlanSummary(planId: string): Promise<CalibrationPlanRecordSummary | null> {
  const config = await getObservatoryCalibrationConfig();
  const runtime = config.metastore.runtime;
  const namespace = config.metastore.planNamespace;
  const trimmedId = planId.trim();
  if (!trimmedId) {
    return null;
  }
  const headers = buildHeaders(runtime.token, runtime.userAgent);
  const baseUrl = buildBaseUrl(runtime.baseUrl);

  const response = await fetch(
    `${baseUrl}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(trimmedId)}`,
    {
      method: 'GET',
      headers
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to load calibration plan ${trimmedId}: ${response.status} ${detail}`);
  }

  const payload = await readJson<MetastoreGetResponse>(response);
  const summary = parseCalibrationPlanSummary(payload.record?.metadata ?? null);
  return summary;
}
