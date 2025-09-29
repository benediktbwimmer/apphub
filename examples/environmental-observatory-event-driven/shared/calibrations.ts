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
    metadata: z.record(z.unknown()).default({})
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
