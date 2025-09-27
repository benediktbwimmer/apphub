import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, beforeEach, vi, it } from 'vitest';
import type {
  DatasetRecord,
  LifecycleStatusResponse,
  ManifestResponse,
  RetentionResponse
} from '../types';
import { useDatasetDetails } from '../hooks/useDatasetDetails';

const {
  mockAuthorizedFetch,
  fetchDatasetByIdMock,
  fetchDatasetManifestMock,
  fetchRetentionPolicyMock,
  fetchLifecycleStatusMock,
  fetchMetricsMock
} = vi.hoisted(() => ({
  mockAuthorizedFetch: vi.fn(),
  fetchDatasetByIdMock: vi.fn(),
  fetchDatasetManifestMock: vi.fn(),
  fetchRetentionPolicyMock: vi.fn(),
  fetchLifecycleStatusMock: vi.fn(),
  fetchMetricsMock: vi.fn()
}));

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockAuthorizedFetch
}));

vi.mock('../api', () => ({
  fetchDatasetById: fetchDatasetByIdMock,
  fetchDatasetManifest: fetchDatasetManifestMock,
  fetchRetentionPolicy: fetchRetentionPolicyMock,
  fetchLifecycleStatus: fetchLifecycleStatusMock,
  fetchMetrics: fetchMetricsMock,
  createDataset: vi.fn(),
  fetchDatasets: vi.fn()
}));

const SAMPLE_DATASET: DatasetRecord = {
  id: 'ds-1',
  slug: 'ds-1',
  name: 'Dataset 1',
  status: 'active',
  createdAt: '2024-05-01T00:00:00.000Z',
  updatedAt: '2024-05-01T00:00:00.000Z',
  metadata: {},
  defaultStorageTargetId: null
} as DatasetRecord;

const SAMPLE_MANIFEST: ManifestResponse = {
  datasetId: 'ds-1',
  manifest: {
    id: 'manifest-1',
    version: 2,
    createdAt: '2024-05-02T00:00:00.000Z',
    schemaVersion: null,
    partitions: []
  }
};

const SAMPLE_RETENTION: RetentionResponse = {
  datasetId: 'ds-1',
  datasetSlug: 'ds-1',
  policy: {
    mode: 'time',
    rules: {}
  },
  updatedAt: '2024-05-02T00:00:00.000Z',
  effectivePolicy: {
    mode: 'time',
    rules: {}
  },
  defaultPolicy: {
    mode: 'hybrid',
    rules: {}
  }
};

const SAMPLE_LIFECYCLE: LifecycleStatusResponse = {
  jobs: [
    {
      id: 'job-1',
      jobKind: 'maintenance',
      datasetId: 'ds-1',
      operations: ['compaction'],
      status: 'completed',
      triggerSource: 'manual',
      scheduledFor: null,
      startedAt: '2024-05-03T00:00:00.000Z',
      completedAt: '2024-05-03T00:05:00.000Z',
      durationMs: 300000,
      attempts: 1,
      error: null,
      metadata: {},
      createdAt: '2024-05-03T00:00:00.000Z',
      updatedAt: '2024-05-03T00:05:00.000Z'
    }
  ],
  metrics: {
    jobsStarted: 1,
    jobsCompleted: 1,
    jobsFailed: 0,
    jobsSkipped: 0,
    lastRunAt: '2024-05-03T00:05:00.000Z',
    lastErrorAt: null,
    operationTotals: {
      compaction: { count: 1, bytes: 1024, partitions: 1 },
      retention: { count: 0, bytes: 0, partitions: 0 },
      parquetExport: { count: 0, bytes: 0, partitions: 0 }
    },
    exportLatencyMs: []
  }
};

const SAMPLE_METRICS = 'timestore_ingest_requests_total 5';

describe('useDatasetDetails', () => {
  const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    consoleDebugSpy.mockImplementation(() => {});

    fetchDatasetByIdMock.mockResolvedValue(SAMPLE_DATASET);
    fetchDatasetManifestMock.mockResolvedValue(SAMPLE_MANIFEST);
    fetchRetentionPolicyMock.mockResolvedValue(SAMPLE_RETENTION);
    fetchLifecycleStatusMock.mockResolvedValue(SAMPLE_LIFECYCLE);
    fetchMetricsMock.mockResolvedValue(SAMPLE_METRICS);

  });

  afterEach(() => {
    consoleDebugSpy.mockReset();
  });

  afterAll(() => {
    consoleDebugSpy.mockRestore();
  });

  it('loads dataset resources on mount', async () => {
    const { result } = renderHook(() => useDatasetDetails('ds-1'));

    await waitFor(() => {
      expect(result.current.dataset.data?.id).toBe('ds-1');
    });

    expect(fetchDatasetByIdMock).toHaveBeenCalledTimes(1);
    expect(fetchDatasetManifestMock).toHaveBeenCalledTimes(1);
    expect(fetchRetentionPolicyMock).toHaveBeenCalledTimes(1);
    expect(fetchLifecycleStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchMetricsMock).toHaveBeenCalledTimes(1);

    expect(result.current.manifest.data).toEqual(SAMPLE_MANIFEST);
    expect(result.current.retention.data).toEqual(SAMPLE_RETENTION);
    expect(result.current.lifecycle.data).toEqual(SAMPLE_LIFECYCLE);
    expect(result.current.metrics.data).toBe(SAMPLE_METRICS);
  });

  it('refetches only requested resource when refreshing retention', async () => {
    const { result } = renderHook(() => useDatasetDetails('ds-1'));

    await waitFor(() => {
      expect(fetchDatasetByIdMock).toHaveBeenCalledTimes(1);
    });

    fetchDatasetByIdMock.mockClear();
    fetchDatasetManifestMock.mockClear();
    fetchRetentionPolicyMock.mockClear();
    fetchLifecycleStatusMock.mockClear();
    fetchMetricsMock.mockClear();

    await act(async () => {
      await result.current.refreshRetention();
    });

    expect(fetchRetentionPolicyMock).toHaveBeenCalledTimes(1);
    expect(fetchDatasetByIdMock).not.toHaveBeenCalled();
    expect(fetchDatasetManifestMock).not.toHaveBeenCalled();
    expect(fetchLifecycleStatusMock).not.toHaveBeenCalled();
    expect(fetchMetricsMock).not.toHaveBeenCalled();
  });

  it('updates dataset state when applying local changes', async () => {
    const { result } = renderHook(() => useDatasetDetails('ds-1'));

    await waitFor(() => {
      expect(result.current.dataset.data?.id).toBe('ds-1');
    });

    const updated: DatasetRecord = {
      ...SAMPLE_DATASET,
      displayName: 'Updated dataset',
      updatedAt: '2024-05-05T00:00:00.000Z'
    };

    act(() => {
      result.current.applyDatasetUpdate(updated);
    });

    expect(result.current.dataset.data).toEqual(updated);
    expect(result.current.dataset.loading).toBe(false);
  });
});
