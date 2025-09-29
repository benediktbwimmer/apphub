import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import {
  fetchRuntimeScalingOverview,
  updateRuntimeScalingTarget
} from './api';
import type { RuntimeScalingOverview, RuntimeScalingTarget, RuntimeScalingUpdateInput } from './types';

export type RuntimeScalingSettingsState = {
  targets: RuntimeScalingTarget[];
  writesEnabled: boolean;
  loading: boolean;
  error: string | null;
  updating: Record<string, boolean>;
  refresh: () => Promise<void>;
  updateTarget: (target: string, input: RuntimeScalingUpdateInput) => Promise<RuntimeScalingTarget>;
};

export function useRuntimeScalingSettings(): RuntimeScalingSettingsState {
  const authorizedFetch = useAuthorizedFetch();
  const [targets, setTargets] = useState<RuntimeScalingTarget[]>([]);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result: RuntimeScalingOverview = await fetchRuntimeScalingOverview(authorizedFetch);
      setTargets(result.targets);
      setWritesEnabled(result.writesEnabled);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load runtime scaling settings';
      setError(message);
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTarget = useCallback(
    async (targetKey: string, input: RuntimeScalingUpdateInput): Promise<RuntimeScalingTarget> => {
      setUpdating((prev) => ({ ...prev, [targetKey]: true }));
      try {
        const result = await updateRuntimeScalingTarget(authorizedFetch, targetKey, input);
        setWritesEnabled(result.writesEnabled);
        setTargets((prev) => {
          const index = prev.findIndex((entry) => entry.target === result.target.target);
          if (index === -1) {
            return [...prev, result.target];
          }
          const next = [...prev];
          next[index] = result.target;
          return next;
        });
        setError(null);
        return result.target;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update runtime scaling target';
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setUpdating((prev) => {
          const next = { ...prev };
          delete next[targetKey];
          return next;
        });
      }
    },
    [authorizedFetch]
  );

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const memoizedState = useMemo<RuntimeScalingSettingsState>(
    () => ({ targets, writesEnabled, loading, error, updating, refresh, updateTarget }),
    [targets, writesEnabled, loading, error, updating, refresh, updateTarget]
  );

  return memoizedState;
}
