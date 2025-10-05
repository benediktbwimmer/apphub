import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDetailMock = vi.hoisted(() => vi.fn());
const fetchBundleMock = vi.hoisted(() => vi.fn());

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({
    activeToken: 'token-123',
    identity: null,
    identityLoading: false,
    identityError: null,
    refreshIdentity: vi.fn(),
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    refreshApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    setActiveToken: vi.fn()
  })
}));

vi.mock('../../api', () => ({
  fetchJobDetail: (...args: unknown[]) => fetchDetailMock(...args),
  fetchJobBundleEditor: (...args: unknown[]) => fetchBundleMock(...args)
}));

import { renderHook, waitFor } from '@testing-library/react';
import type { BundleEditorData, JobDetailResponse } from '../../api';
import { useJobSnapshot } from '../useJobSnapshot';

function buildDetail(slug: string): JobDetailResponse {
  const now = new Date().toISOString();
  return {
    job: {
      id: slug,
      slug,
      name: slug,
      version: 1,
      type: 'task',
      runtime: 'node',
      entryPoint: 'index.ts',
      registryRef: null,
      parametersSchema: null,
      defaultParameters: null,
      outputSchema: null,
      timeoutMs: null,
      retryPolicy: null,
      metadata: null,
      createdAt: now,
      updatedAt: now
    },
    runs: []
  };
}

function buildBundle(slug: string): BundleEditorData {
  const now = new Date().toISOString();
  return {
    job: buildDetail(slug).job,
    binding: { slug, version: '1.0.0', exportName: null },
    bundle: {
      version: '1.0.0',
      checksum: 'abc',
      capabilityFlags: [],
      status: 'active',
      immutable: false,
      publishedAt: now,
      deprecatedAt: null,
      artifact: { storage: 's3', size: null, contentType: null },
      metadata: null
    },
    editor: {
      entryPoint: 'index.ts',
      manifestPath: 'manifest.json',
      manifest: {},
      files: [
        {
          path: 'index.ts',
          contents: 'export const handler = () => {}',
          encoding: 'utf8',
          executable: false
        }
      ]
    },
    aiBuilder: null,
    history: [],
    suggestionSource: 'metadata',
    availableVersions: []
  } satisfies BundleEditorData;
}

describe('useJobSnapshot', () => {
  beforeEach(() => {
    fetchDetailMock.mockReset();
    fetchBundleMock.mockReset();
  });

  it('loads detail and bundle for a job', async () => {
    fetchDetailMock.mockResolvedValueOnce(buildDetail('job-1'));
    fetchBundleMock.mockResolvedValueOnce(buildBundle('job-1'));
    const { result } = renderHook(() => useJobSnapshot('job-1'));

    await waitFor(() => expect(result.current.detailLoading).toBe(false));

    expect(fetchDetailMock).toHaveBeenCalledWith('token-123', 'job-1', { signal: expect.any(AbortSignal) });
    expect(fetchBundleMock).toHaveBeenCalledWith('token-123', 'job-1', { signal: expect.any(AbortSignal) });

    expect(result.current.detail?.job.slug).toBe('job-1');
    expect(result.current.bundle?.binding.slug).toBe('job-1');
    expect(result.current.detailError).toBeNull();
    expect(result.current.bundleError).toBeNull();
  });

  it('resets state when slug is null', async () => {
    fetchDetailMock.mockResolvedValueOnce(buildDetail('job-2'));
    fetchBundleMock.mockResolvedValueOnce(buildBundle('job-2'));

    const { result, rerender } = renderHook(
      ({ slug }: { slug: string | null }) => useJobSnapshot(slug),
      { initialProps: { slug: 'job-2' as string | null } }
    );

    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    expect(result.current.detail).not.toBeNull();

    rerender({ slug: null });

    await waitFor(() => {
      expect(result.current.detail).toBeNull();
      expect(result.current.bundle).toBeNull();
      expect(result.current.detailError).toBeNull();
      expect(result.current.bundleError).toBeNull();
    });
  });

  it('records errors on failure', async () => {
    fetchDetailMock.mockRejectedValueOnce(new Error('uh oh'));
    fetchBundleMock.mockResolvedValueOnce(buildBundle('job-3'));
    const { result } = renderHook(() => useJobSnapshot('job-3'));

    await waitFor(() => expect(result.current.detailLoading).toBe(false));

    expect(result.current.detailError).toBe('uh oh');
    expect(result.current.bundleError).toBe('uh oh');
    expect(result.current.detail).toBeNull();
    expect(result.current.bundle).toBeNull();
  });
});
