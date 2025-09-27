import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback } from 'react';
import { usePollingResource } from '../usePollingResource';
import type { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';

type MockService = { id: string };

type PollingContext = {
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>;
  signal: AbortSignal;
};

const mockAuthorizedFetch = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockAuthorizedFetch
}));

const createResponse = (body: unknown, init?: { status?: number; ok?: boolean }) => ({
  ok: init?.ok ?? true,
  status: init?.status ?? 200,
  async json() {
    return body;
  }
}) as unknown as Response;

beforeEach(() => {
  mockAuthorizedFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePollingResource', () => {
  it('fetches the resource immediately and updates state', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(createResponse({ data: [{ id: 'svc-a' }] }));

    const { result } = renderHook(() => {
      const fetcher = useCallback(async ({ authorizedFetch, signal }: PollingContext) => {
        const response = await authorizedFetch('/services', { signal });
        const payload = (await response.json()) as { data: MockService[] };
        return payload.data;
      }, []);

      return usePollingResource<MockService[]>({ fetcher });
    });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([{ id: 'svc-a' }]);
  });

  it('schedules polling and supports manual refetch', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const responses = [
      createResponse({ data: [{ id: 'svc-a' }] }),
      createResponse({ data: [{ id: 'svc-b' }] })
    ];
    mockAuthorizedFetch.mockImplementation(async () => {
      const next = responses.shift();
      if (!next) {
        throw new Error('No more responses');
      }
      return next;
    });

    const { result } = renderHook(() => {
      const fetcher = useCallback(async ({ authorizedFetch, signal }: PollingContext) => {
        const response = await authorizedFetch('/services', { signal });
        const payload = (await response.json()) as { data: MockService[] };
        return payload.data;
      }, []);

      return usePollingResource<MockService[]>({
        intervalMs: 1000,
        fetcher
      });
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'svc-a' }]);
    });

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(mockAuthorizedFetch).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'svc-b' }]);
    });

    timeoutSpy.mockRestore();
  });

  it('fetches immediately when the fetcher input changes', async () => {
    mockAuthorizedFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const id = url.split('/').pop() ?? 'unknown';
      return createResponse({ data: { id } });
    });

    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) => {
        const fetcher = useCallback(
          async ({ authorizedFetch, signal }: PollingContext) => {
            const response = await authorizedFetch(`/services/${resourceId}`, { signal });
            const payload = (await response.json()) as { data: MockService };
            return payload.data;
          },
          [resourceId]
        );

        return usePollingResource<MockService>({
          intervalMs: 10_000,
          fetcher
        });
      },
      { initialProps: { resourceId: 'svc-a' } }
    );

    await waitFor(() => {
      expect(result.current.data?.id).toBe('svc-a');
    });

    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1);

    rerender({ resourceId: 'svc-b' });

    await waitFor(() => {
      expect(result.current.data?.id).toBe('svc-b');
    });

    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(2);
  });
});
