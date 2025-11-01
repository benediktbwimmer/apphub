import { createHash } from 'node:crypto';
import { z } from 'zod';

const isoDateRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))$/;

export const calibrationMeasurementOffsetsSchema = z
  .object({
    temperature_c: z.number().finite().optional(),
    relative_humidity_pct: z.number().finite().optional(),
    pm2_5_ug_m3: z.number().finite().optional(),
    battery_voltage: z.number().finite().optional()
  })
  .strip();

export const calibrationMeasurementScalesSchema = z
  .object({
    temperature_c: z.number().finite().optional(),
    relative_humidity_pct: z.number().finite().optional(),
    pm2_5_ug_m3: z.number().finite().optional(),
    battery_voltage: z.number().finite().optional()
  })
  .strip();

export const calibrationFileSchema = z
  .object({
    instrumentId: z.string().min(1, 'instrumentId is required'),
    effectiveAt: z
      .string()
      .regex(isoDateRegex, 'effectiveAt must be ISO-8601 with offset (e.g. 2025-01-01T00:00:00Z)'),
    createdAt: z
      .string()
      .regex(isoDateRegex, 'createdAt must be ISO-8601 with offset')
      .optional(),
    revision: z.number().int().nonnegative().optional(),
    offsets: calibrationMeasurementOffsetsSchema.default({}),
    scales: calibrationMeasurementScalesSchema.optional(),
    notes: z.string().max(10_000).optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strip();

export type CalibrationFile = z.infer<typeof calibrationFileSchema>;

export type NormalizedCalibrationRecord = {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  createdAt: string;
  revision: number | null;
  offsets: Record<string, number>;
  scales: Record<string, number> | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  sourceChecksum: string;
};

export function normalizeCalibrationRecord(payload: CalibrationFile, rawContent: string): NormalizedCalibrationRecord {
  const effectiveAt = new Date(payload.effectiveAt).toISOString();
  const createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString();
  const calibrationId = `${sanitizeIdentifier(payload.instrumentId)}:${effectiveAt}`;

  const checksum = createHash('sha256').update(rawContent, 'utf8').digest('hex');

  return {
    calibrationId,
    instrumentId: payload.instrumentId.trim(),
    effectiveAt,
    createdAt,
    revision: payload.revision ?? null,
    offsets: Object.fromEntries(
      Object.entries(payload.offsets ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    ),
    scales: payload.scales
      ? Object.fromEntries(
          Object.entries(payload.scales ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        )
      : null,
    notes: payload.notes?.trim() ? payload.notes.trim() : null,
    metadata: sanitizeMetadata(payload.metadata ?? {}),
    sourceChecksum: checksum
  } satisfies NormalizedCalibrationRecord;
}

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value ?? {}).filter(([key]) => typeof key === 'string' && key.trim().length > 0);
  return Object.fromEntries(entries);
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export function buildMetastoreRecordPayload(record: NormalizedCalibrationRecord): Record<string, unknown> {
  return {
    type: 'observatory.calibration',
    status: 'active',
    instrumentId: record.instrumentId,
    effectiveAt: record.effectiveAt,
    createdAt: record.createdAt,
    revision: record.revision,
    offsets: record.offsets,
    scales: record.scales,
    notes: record.notes,
    metadata: record.metadata,
    checksum: record.sourceChecksum
  } satisfies Record<string, unknown>;
}

export function deriveMetastoreKey(record: NormalizedCalibrationRecord): string {
  return record.calibrationId;
}

const CALIBRATION_VALUE_FIELDS = [
  'temperature_c',
  'relative_humidity_pct',
  'pm2_5_ug_m3',
  'battery_voltage'
] as const;

export type CalibrationSnapshot = {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  createdAt: string | null;
  revision: number | null;
  offsets: Record<string, number>;
  scales: Record<string, number> | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  checksum: string | null;
  metastoreVersion: number | null;
};

export type CalibrationLookupConfig = {
  baseUrl: string;
  namespace: string;
  authToken?: string;
};

export type CalibrationLookupResult = {
  active: CalibrationSnapshot | null;
  latest: CalibrationSnapshot | null;
  all: CalibrationSnapshot[];
};

export function calibrationMeasurementFields(): readonly string[] {
  return CALIBRATION_VALUE_FIELDS;
}

function toJsonRecordStrict(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function toNumberRecord(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!value || typeof value !== 'object') {
    return result;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) {
      continue;
    }
    const numeric =
      typeof entry === 'number'
        ? entry
        : typeof entry === 'string'
          ? Number(entry)
          : null;
    if (numeric !== null && Number.isFinite(numeric)) {
      result[key] = numeric;
    }
  }
  return result;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function toCalibrationSnapshot(entry: {
  key?: unknown;
  version?: unknown;
  metadata?: unknown;
}): CalibrationSnapshot | null {
  const calibrationId =
    typeof entry.key === 'string' && entry.key.trim().length > 0 ? entry.key.trim() : null;
  if (!calibrationId) {
    return null;
  }
  const version = typeof entry.version === 'number' && Number.isFinite(entry.version) ? entry.version : null;
  const metadata = toJsonRecordStrict(entry.metadata);
  const instrumentIdRaw = metadata.instrumentId ?? metadata.instrument_id;
  const instrumentId = typeof instrumentIdRaw === 'string' ? instrumentIdRaw.trim() : '';
  if (!instrumentId) {
    return null;
  }
  const effectiveAtRaw = metadata.effectiveAt ?? metadata.effective_at;
  const effectiveAt = normalizeIsoTimestamp(effectiveAtRaw);
  if (!effectiveAt) {
    return null;
  }
  const createdAt = normalizeIsoTimestamp(metadata.createdAt ?? metadata.created_at);
  const revisionRaw = metadata.revision;
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw)
      ? Math.trunc(revisionRaw)
      : null;
  const offsets = toNumberRecord(metadata.offsets);
  const scalesRecord = toNumberRecord(metadata.scales);
  const scales = Object.keys(scalesRecord).length > 0 ? scalesRecord : null;
  const notesRaw = metadata.notes;
  const notes =
    typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw.trim() : null;
  const checksumRaw = metadata.checksum ?? metadata.sourceChecksum ?? metadata.source_checksum;
  const checksum =
    typeof checksumRaw === 'string' && checksumRaw.trim().length > 0 ? checksumRaw.trim() : null;
  const metadataField = sanitizeMetadata(toJsonRecordStrict(metadata.metadata));

  return {
    calibrationId,
    instrumentId,
    effectiveAt,
    createdAt,
    revision,
    offsets,
    scales,
    notes,
    metadata: metadataField,
    checksum,
    metastoreVersion: version
  } satisfies CalibrationSnapshot;
}

function parseAsOfTimestamp(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export async function lookupCalibration(
  config: CalibrationLookupConfig,
  instrumentId: string,
  asOfIso: string,
  options: { limit?: number } = {}
): Promise<CalibrationLookupResult> {
  const trimmedInstrument = instrumentId.trim();
  if (!trimmedInstrument) {
    return { active: null, latest: null, all: [] };
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const limit = Math.max(1, options.limit ?? 5);

  const response = await fetch(`${baseUrl}/records/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      namespace: config.namespace,
      limit,
      sort: [
        { field: 'metadata.effectiveAt', direction: 'desc' },
        { field: 'version', direction: 'desc' }
      ],
      filter: {
        field: 'metadata.instrumentId',
        operator: 'eq',
        value: trimmedInstrument
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(
      `Failed to search calibrations for ${trimmedInstrument}: ${response.status} ${detail}`
    );
  }

  const payload = (await response.json()) as {
    records?: Array<Record<string, unknown>>;
  };

  const snapshots: CalibrationSnapshot[] = [];
  for (const record of payload.records ?? []) {
    const snapshot = toCalibrationSnapshot(record);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  const latest = snapshots[0] ?? null;
  const asOfMs = parseAsOfTimestamp(asOfIso);
  let active: CalibrationSnapshot | null = null;
  if (asOfMs !== null) {
    for (const snapshot of snapshots) {
      const effectiveMs = parseAsOfTimestamp(snapshot.effectiveAt);
      if (effectiveMs !== null && effectiveMs <= asOfMs) {
        active = snapshot;
        break;
      }
    }
  }

  return { active, latest, all: snapshots };
}

export async function fetchCalibrationById(
  config: CalibrationLookupConfig,
  calibrationId: string
): Promise<CalibrationSnapshot | null> {
  const trimmedId = calibrationId.trim();
  if (!trimmedId) {
    return null;
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(
    `${baseUrl}/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(trimmedId)}`,
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
    throw new Error(
      `Failed to fetch calibration ${trimmedId}: ${response.status} ${detail}`
    );
  }

  const payload = (await response.json()) as {
    record?: { metadata?: unknown; version?: number | null } | null;
  };

  const snapshot = toCalibrationSnapshot({
    key: trimmedId,
    version: payload.record?.version ?? null,
    metadata: payload.record?.metadata ?? null
  });

  return snapshot;
}

export function applyCalibrationAdjustments(
  measurements: Partial<Record<string, number>>,
  adjustments: { offsets: Record<string, number>; scales: Record<string, number> | null }
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of CALIBRATION_VALUE_FIELDS) {
    const value = measurements[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const scale = adjustments.scales?.[field];
    const offset = adjustments.offsets[field];
    let next = value;
    if (typeof scale === 'number' && Number.isFinite(scale)) {
      next *= scale;
    }
    if (typeof offset === 'number' && Number.isFinite(offset)) {
      next += offset;
    }
    if (field === 'relative_humidity_pct') {
      next = Math.min(100, Math.max(0, next));
    }
    if (field === 'pm2_5_ug_m3') {
      next = Math.max(0, next);
    }
    result[field] = Number.isFinite(next) ? next : value;
  }
  return result;
}
