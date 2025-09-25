import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAppHubEvent } from '../events/context';
import {
  normalizeBundleStatus,
  type ExampleBundleStatus,
  type ExampleBundleStatusResponse
} from './exampleBundles';

type BundleStatusMap = Map<string, ExampleBundleStatus>;

function slugKey(slug: string): string {
  return slug.trim().toLowerCase();
}

export function useExampleBundleProgress() {
  const authorizedFetch = useAuthorizedFetch();
  const [statuses, setStatuses] = useState<BundleStatusMap>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authorizedFetch(`${API_BASE_URL}/examples/bundles/status`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = typeof payload?.error === 'string' ? payload.error : `Failed to load bundle statuses (${response.status})`;
        throw new Error(message);
      }
      const payload = (await response.json()) as ExampleBundleStatusResponse;
      const entries = (payload.data.statuses ?? []).map((status) => {
        const normalized = normalizeBundleStatus(status);
        return [slugKey(normalized.slug), normalized] as const;
      });
      setStatuses(new Map(entries));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAppHubEvent('example.bundle.progress', (event) => {
    setStatuses((prev) => {
      const next = new Map(prev);
      const normalized = normalizeBundleStatus(event.data);
      next.set(slugKey(normalized.slug), normalized);
      return next;
    });
  });

  const statusBySlug = useMemo(() => Object.fromEntries(statuses), [statuses]);

  const getStatus = useCallback(
    (slug: string | null | undefined): ExampleBundleStatus | null => {
      if (!slug) {
        return null;
      }
      return statusBySlug[slugKey(slug)] ?? null;
    },
    [statusBySlug]
  );

  const statusList = useMemo(() => Array.from(statuses.values()), [statuses]);

  const retryBundle = useCallback(
    async (slug: string) => {
      const normalizedSlug = slugKey(slug);
      if (!normalizedSlug) {
        throw new Error('Example slug is required to retry packaging');
      }
      const response = await authorizedFetch(`${API_BASE_URL}/job-imports/example`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: normalizedSlug, force: true })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = typeof payload?.error === 'string' ? payload.error : `Failed to retry packaging (${response.status})`;
        throw new Error(message);
      }
      await refresh();
    },
    [authorizedFetch, refresh]
  );

  return {
    loading,
    error,
    refresh,
    getStatus,
    retryBundle,
    statuses: statusList
  } as const;
}
