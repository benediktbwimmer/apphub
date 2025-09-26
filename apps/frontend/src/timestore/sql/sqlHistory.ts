export const SQL_HISTORY_STORAGE_KEY = 'apphub:timestore:sql-history';
export const SQL_HISTORY_LIMIT = 50;

export interface SqlHistoryEntry {
  id: string;
  statement: string;
  createdAt: string;
  label?: string | null;
  pinned?: boolean;
  stats?: {
    rowCount?: number;
    elapsedMs?: number;
  };
}

function sortHistory(entries: SqlHistoryEntry[]): SqlHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function clampHistory(entries: SqlHistoryEntry[], limit: number): SqlHistoryEntry[] {
  if (entries.length <= limit) {
    return entries;
  }
  const pinned = entries.filter((entry) => entry.pinned);
  const remainingSlots = Math.max(limit - pinned.length, 0);
  const unpinned = entries.filter((entry) => !entry.pinned).slice(0, remainingSlots);
  return [...pinned, ...unpinned];
}

export function addHistoryEntry(
  history: SqlHistoryEntry[],
  entry: SqlHistoryEntry,
  limit: number = SQL_HISTORY_LIMIT
): SqlHistoryEntry[] {
  const normalizedStatement = entry.statement.trim();
  let preserved: Pick<SqlHistoryEntry, 'pinned' | 'label'> | null = null;

  const deduped = history.filter((item) => {
    const matches = item.statement.trim() === normalizedStatement;
    if (matches && !preserved) {
      preserved = {
        pinned: item.pinned,
        label: item.label ?? null
      };
    }
    return !matches;
  });

  const mergedEntry: SqlHistoryEntry = {
    ...entry,
    pinned: preserved?.pinned ?? entry.pinned,
    label: preserved?.label ?? entry.label ?? null
  };

  const next = sortHistory([mergedEntry, ...deduped]);
  return clampHistory(next, limit);
}

export function updateHistoryEntry(
  history: SqlHistoryEntry[],
  id: string,
  changes: Partial<SqlHistoryEntry>,
  limit: number = SQL_HISTORY_LIMIT
): SqlHistoryEntry[] {
  const next = history.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry));
  return clampHistory(sortHistory(next), limit);
}

export function removeHistoryEntry(history: SqlHistoryEntry[], id: string): SqlHistoryEntry[] {
  return history.filter((entry) => entry.id !== id);
}

export function clearUnpinnedHistory(history: SqlHistoryEntry[]): SqlHistoryEntry[] {
  return history.filter((entry) => entry.pinned);
}

export function readHistoryFromStorage(storage: Storage | null): SqlHistoryEntry[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(SQL_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SqlHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return clampHistory(
      sortHistory(
        parsed.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt ?? new Date().toISOString()
        }))
      ),
      SQL_HISTORY_LIMIT
    );
  } catch {
    return [];
  }
}

export function writeHistoryToStorage(storage: Storage | null, history: SqlHistoryEntry[]): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SQL_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Swallow storage quota errors.
  }
}

export function createHistoryEntry(params: {
  statement: string;
  rowCount?: number;
  elapsedMs?: number;
  label?: string | null;
  pinned?: boolean;
  id?: string;
}): SqlHistoryEntry {
  const { statement, rowCount, elapsedMs, label, pinned = false, id } = params;
  const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `sql_${Math.random().toString(36).slice(2, 10)}`;
  };

  return {
    id: id ?? generateId(),
    statement,
    createdAt: new Date().toISOString(),
    label: label ?? null,
    pinned,
    stats:
      rowCount === undefined && elapsedMs === undefined
        ? undefined
        : {
            rowCount,
            elapsedMs
          }
  };
}
