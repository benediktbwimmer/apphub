import { describe, expect, it } from 'vitest';
import { toCalibrationUploadPayload, toPlanReprocessPayload } from '../api';

describe('observatory api helpers', () => {
  it('normalizes calibration upload payload', () => {
    const payload = toCalibrationUploadPayload({
      instrumentId: 'instrument_alpha',
      effectiveAt: '2025-01-01T00:00:00Z',
      createdAt: '2024-12-31T23:45:00Z',
      revision: 2,
      offsets: { temperature_c: 0.15 },
      scales: { temperature_c: 1.01 },
      metadata: { operator: 'ops@example.com' },
      notes: 'Primary calibration',
      filename: 'instrument_alpha_calibration.json',
      overwrite: true
    });

    expect(payload).toMatchObject({
      instrumentId: 'instrument_alpha',
      effectiveAt: '2025-01-01T00:00:00Z',
      createdAt: '2024-12-31T23:45:00Z',
      revision: 2,
      offsets: { temperature_c: 0.15 },
      scales: { temperature_c: 1.01 },
      metadata: { operator: 'ops@example.com' },
      notes: 'Primary calibration',
      filename: 'instrument_alpha_calibration.json',
      overwrite: true
    });
  });

  it('builds plan reprocess payload', () => {
    const payload = toPlanReprocessPayload({
      mode: 'selected',
      selectedPartitions: ['2025-01-01T00:00', '2025-01-01T00:01'],
      maxConcurrency: 5,
      pollIntervalMs: 2000,
      runKey: 'plan-001-run',
      triggeredBy: 'unit-test'
    });

    expect(payload).toEqual({
      mode: 'selected',
      selectedPartitions: ['2025-01-01T00:00', '2025-01-01T00:01'],
      maxConcurrency: 5,
      pollIntervalMs: 2000,
      runKey: 'plan-001-run',
      triggeredBy: 'unit-test'
    });
  });
});
