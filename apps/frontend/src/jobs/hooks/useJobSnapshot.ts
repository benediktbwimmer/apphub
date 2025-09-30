import { useCallback, useEffect, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import type { AuthorizedFetch } from '../../workflows/api';
import {
  fetchJobBundleEditor,
  fetchJobDetail,
  type BundleEditorData,
  type JobDetailResponse
} from '../api';

type UseJobSnapshotOptions = {
  fetcher?: AuthorizedFetch;
};

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
  slug: string | null,
  options: UseJobSnapshotOptions = {}
): UseJobSnapshotResult {
  const authorizedFetch = useAuthorizedFetch();
  const fetcher = options.fetcher ?? authorizedFetch;
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
        const [detail, bundle] = await Promise.all([
          fetchJobDetail(fetcher, slug),
          fetchJobBundleEditor(fetcher, slug)
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
    };
  }, [fetcher, slug, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return {
    ...state,
    refresh
  };
}
