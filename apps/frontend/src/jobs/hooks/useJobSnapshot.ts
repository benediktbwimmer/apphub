import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import {
  fetchJobBundleEditor,
  fetchJobDetail,
  type BundleEditorData,
  type JobDetailResponse
} from '../api';

export type UseJobSnapshotResult = {
  detail: JobDetailResponse | null;
  detailLoading: boolean;
  detailError: string | null;
  bundle: BundleEditorData | null;
  bundleLoading: boolean;
  bundleError: string | null;
  refresh: () => void;
};

const emptySnapshotState = {
  detail: null,
  detailLoading: false,
  detailError: null,
  bundle: null,
  bundleLoading: false,
  bundleError: null
} as const satisfies Omit<UseJobSnapshotResult, 'refresh'>;

export function useJobSnapshot(
  slug: string | null
): UseJobSnapshotResult {
  const { activeToken } = useAuth();
  const [state, setState] = useState<Omit<UseJobSnapshotResult, 'refresh'>>(emptySnapshotState);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    if (!slug) {
      setState(emptySnapshotState);
      return () => {
        canceled = true;
      };
    }

    const controller = new AbortController();

    setState({
      detail: null,
      detailLoading: true,
      detailError: null,
      bundle: null,
      bundleLoading: true,
      bundleError: null
    });

    const run = async () => {
      try {
        if (!activeToken) {
          throw new Error('Authentication required to load job detail');
        }
        const [detail, bundle] = await Promise.all([
          fetchJobDetail(activeToken, slug, { signal: controller.signal }),
          fetchJobBundleEditor(activeToken, slug, { signal: controller.signal })
        ]);
        if (!canceled) {
          setState({
            detail,
            detailLoading: false,
            detailError: null,
            bundle,
            bundleLoading: false,
            bundleError: null
          });
        }
      } catch (err) {
        if (!canceled) {
          const message = err instanceof Error ? err.message : 'Failed to load job detail';
          setState({
            detail: null,
            detailLoading: false,
            detailError: message,
            bundle: null,
            bundleLoading: false,
            bundleError: message
          });
        }
      }
    };

    void run();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [activeToken, slug, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return {
    ...state,
    refresh
  };
}
