import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EventSavedViewRecord,
  EventSavedViewCreateInput,
  EventSavedViewUpdateInput
} from '@apphub/shared/eventsExplorer';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAuth } from '../auth/useAuth';
import {
  listSavedEventViews,
  createSavedEventView,
  updateSavedEventView,
  deleteSavedEventView,
  applySavedEventView,
  shareSavedEventView
} from './api';

function sortSavedViews(views: EventSavedViewRecord[]): EventSavedViewRecord[] {
  return views
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function mergeSavedView(
  current: EventSavedViewRecord[],
  next: EventSavedViewRecord
): EventSavedViewRecord[] {
  const index = current.findIndex((view) => view.id === next.id);
  if (index === -1) {
    return sortSavedViews([...current, next]);
  }
  const copy = current.slice();
  copy[index] = next;
  return sortSavedViews(copy);
}

export type SavedEventViewMutationState = {
  creating: boolean;
  applyingSlug: string | null;
  sharingSlug: string | null;
  updatingSlug: string | null;
  deletingSlug: string | null;
};

export type UseSavedEventViewsResult = {
  savedViews: EventSavedViewRecord[];
  loading: boolean;
  error: string | null;
  mutationState: SavedEventViewMutationState;
  viewerSubject: string | null;
  viewerUserId: string | null;
  refresh: () => Promise<void>;
  createSavedView: (input: EventSavedViewCreateInput) => Promise<EventSavedViewRecord>;
  updateSavedView: (
    slug: string,
    updates: EventSavedViewUpdateInput
  ) => Promise<EventSavedViewRecord | null>;
  deleteSavedView: (slug: string) => Promise<boolean>;
  applySavedView: (slug: string) => Promise<EventSavedViewRecord>;
  shareSavedView: (slug: string) => Promise<EventSavedViewRecord>;
};

export function useSavedEventViews(): UseSavedEventViewsResult {
  const authorizedFetch = useAuthorizedFetch();
  const { identity, identityLoading } = useAuth();

  const [savedViews, setSavedViews] = useState<EventSavedViewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [applyingSlug, setApplyingSlug] = useState<string | null>(null);
  const [sharingSlug, setSharingSlug] = useState<string | null>(null);
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const views = await listSavedEventViews(authorizedFetch);
      setSavedViews(sortSavedViews(views));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    if (identityLoading) {
      setLoading(true);
      return;
    }
    if (identity?.authDisabled) {
      setSavedViews([]);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [identity?.authDisabled, identityLoading, refresh]);

  const createSavedViewHandler = useCallback(
    async (input: EventSavedViewCreateInput): Promise<EventSavedViewRecord> => {
      setCreating(true);
      setError(null);
      try {
        const record = await createSavedEventView(authorizedFetch, input);
        setSavedViews((current) => mergeSavedView(current, record));
        return record;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [authorizedFetch]
  );

  const updateSavedViewHandler = useCallback(
    async (
      slug: string,
      updates: EventSavedViewUpdateInput
    ): Promise<EventSavedViewRecord | null> => {
      setUpdatingSlug(slug);
      setError(null);
      try {
        const record = await updateSavedEventView(authorizedFetch, slug, updates);
        setSavedViews((current) => mergeSavedView(current, record));
        return record;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setUpdatingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const deleteSavedViewHandler = useCallback(
    async (slug: string): Promise<boolean> => {
      setDeletingSlug(slug);
      setError(null);
      try {
        const deleted = await deleteSavedEventView(authorizedFetch, slug);
        if (deleted) {
          setSavedViews((current) => current.filter((view) => view.slug !== slug));
        }
        return deleted;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setDeletingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const applySavedViewHandler = useCallback(
    async (slug: string): Promise<EventSavedViewRecord> => {
      setApplyingSlug(slug);
      setError(null);
      try {
        const record = await applySavedEventView(authorizedFetch, slug);
        setSavedViews((current) => mergeSavedView(current, record));
        return record;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setApplyingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const shareSavedViewHandler = useCallback(
    async (slug: string): Promise<EventSavedViewRecord> => {
      setSharingSlug(slug);
      setError(null);
      try {
        const record = await shareSavedEventView(authorizedFetch, slug);
        setSavedViews((current) => mergeSavedView(current, record));
        return record;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setSharingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const mutationState = useMemo<SavedEventViewMutationState>(
    () => ({ creating, applyingSlug, sharingSlug, updatingSlug, deletingSlug }),
    [creating, applyingSlug, sharingSlug, updatingSlug, deletingSlug]
  );

  return {
    savedViews,
    loading,
    error,
    mutationState,
    viewerSubject: identity?.subject ?? null,
    viewerUserId: identity?.userId ?? null,
    refresh,
    createSavedView: createSavedViewHandler,
    updateSavedView: updateSavedViewHandler,
    deleteSavedView: deleteSavedViewHandler,
    applySavedView: applySavedViewHandler,
    shareSavedView: shareSavedViewHandler
  } satisfies UseSavedEventViewsResult;
}
