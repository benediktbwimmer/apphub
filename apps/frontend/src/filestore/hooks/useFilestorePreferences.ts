import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FilestoreNodeKind } from '../api';

export type ViewMode = 'browse' | 'search';

export type StoredNodeReference = {
  backendMountId: number;
  path: string;
  kind: FilestoreNodeKind;
  displayName: string;
  lastAccessed: number;
};

type FilestorePreferences = {
  viewMode: ViewMode;
  setViewMode: (next: ViewMode) => void;
  recents: StoredNodeReference[];
  pushRecent: (node: Omit<StoredNodeReference, 'lastAccessed'>) => void;
  starred: StoredNodeReference[];
  toggleStar: (node: Omit<StoredNodeReference, 'lastAccessed'>) => void;
  removeStar: (backendMountId: number, path: string) => void;
  isStarred: (backendMountId: number, path: string) => boolean;
};

const VIEW_MODE_STORAGE_KEY = 'apphub.filestore.viewMode';
const RECENTS_STORAGE_KEY = 'apphub.filestore.recentNodes';
const STARRED_STORAGE_KEY = 'apphub.filestore.starredNodes';
const MAX_RECENTS = 12;

function readFromStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[filestore:preferences] Failed to read ${key} from storage`, error);
    return null;
  }
}

function writeToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[filestore:preferences] Failed to persist ${key} to storage`, error);
  }
}

export function useFilestorePreferences(): FilestorePreferences {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = readFromStorage<ViewMode>(VIEW_MODE_STORAGE_KEY);
    return stored === 'search' ? 'search' : 'browse';
  });

  const [recents, setRecents] = useState<StoredNodeReference[]>(() => {
    const stored = readFromStorage<StoredNodeReference[]>(RECENTS_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    return stored
      .filter((entry) => entry.backendMountId && entry.path)
      .map((entry) => ({
        ...entry,
        kind: entry.kind ?? 'file',
        displayName: entry.displayName ?? entry.path.split('/').pop() ?? entry.path,
        lastAccessed: entry.lastAccessed ?? Date.now()
      }));
  });

  const [starred, setStarred] = useState<StoredNodeReference[]>(() => {
    const stored = readFromStorage<StoredNodeReference[]>(STARRED_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    return stored
      .filter((entry) => entry.backendMountId && entry.path)
      .map((entry) => ({
        ...entry,
        kind: entry.kind ?? 'file',
        displayName: entry.displayName ?? entry.path.split('/').pop() ?? entry.path,
        lastAccessed: entry.lastAccessed ?? Date.now()
      }));
  });

  useEffect(() => {
    writeToStorage(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    writeToStorage(RECENTS_STORAGE_KEY, recents);
  }, [recents]);

  useEffect(() => {
    writeToStorage(STARRED_STORAGE_KEY, starred);
  }, [starred]);

  const pushRecent = useCallback(
    (input: Omit<StoredNodeReference, 'lastAccessed'>) => {
      setRecents((prev) => {
        const withoutDupes = prev.filter(
          (entry) => !(entry.backendMountId === input.backendMountId && entry.path === input.path)
        );
        const next: StoredNodeReference[] = [
          { ...input, lastAccessed: Date.now() },
          ...withoutDupes
        ];
        return next.slice(0, MAX_RECENTS);
      });
    },
    []
  );

  const toggleStar = useCallback(
    (input: Omit<StoredNodeReference, 'lastAccessed'>) => {
      setStarred((prev) => {
        const existing = prev.find(
          (entry) => entry.backendMountId === input.backendMountId && entry.path === input.path
        );
        if (existing) {
          return prev.filter(
            (entry) => !(entry.backendMountId === input.backendMountId && entry.path === input.path)
          );
        }
        const next: StoredNodeReference[] = [
          { ...input, lastAccessed: Date.now() },
          ...prev
        ];
        return next;
      });
    },
    []
  );

  const removeStar = useCallback((backendMountId: number, path: string) => {
    setStarred((prev) =>
      prev.filter((entry) => !(entry.backendMountId === backendMountId && entry.path === path))
    );
  }, []);

  const isStarred = useCallback(
    (backendMountId: number, path: string) =>
      starred.some((entry) => entry.backendMountId === backendMountId && entry.path === path),
    [starred]
  );

  const value = useMemo<FilestorePreferences>(
    () => ({ viewMode, setViewMode: setViewModeState, recents, pushRecent, starred, toggleStar, removeStar, isStarred }),
    [viewMode, recents, pushRecent, starred, toggleStar, removeStar, isStarred]
  );

  return value;
}
