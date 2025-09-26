import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePollingResource } from '../usePollingResource';

type MockService = { id: string };

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

    const { result } = renderHook(() =>
      usePollingResource<MockService[]>({
        fetcher: async ({ authorizedFetch, signal }) => {
          const response = await authorizedFetch('/services', { signal });
          const payload = (await response.json()) as { data: MockService[] };
          return payload.data;
        }
      })
    );

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

    const { result } = renderHook(() =>
      usePollingResource<MockService[]>({
        intervalMs: 1000,
        fetcher: async ({ authorizedFetch, signal }) => {
          const response = await authorizedFetch('/services', { signal });
          const payload = (await response.json()) as { data: MockService[] };
          return payload.data;
        }
      })
    );

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
});
