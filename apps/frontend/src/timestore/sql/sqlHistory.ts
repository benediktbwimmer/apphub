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
  updatedAt?: string | null;
}

function sortHistory(entries: SqlHistoryEntry[]): SqlHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }
    return resolveEntryTimestamp(b) - resolveEntryTimestamp(a);
  });
}

function resolveEntryTimestamp(entry: SqlHistoryEntry): number {
  const candidates = [entry.updatedAt, entry.createdAt];
  for (const value of candidates) {
    if (!value) {
      continue;
    }
    const time = Date.parse(value);
    if (!Number.isNaN(time)) {
      return time;
    }
  }
  return 0;
}

function clampHistory(entries: SqlHistoryEntry[], limit: number): SqlHistoryEntry[] {
  if (entries.length <= limit) {
    return entries;
  }
  const pinned: SqlHistoryEntry[] = [];
  const unpinned: SqlHistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.pinned) {
      pinned.push(entry);
    } else {
      unpinned.push(entry);
    }
  }
  const remainingSlots = Math.max(limit - pinned.length, 0);
  return [...pinned, ...unpinned.slice(0, remainingSlots)];
}

export function addHistoryEntry(
  history: SqlHistoryEntry[],
  entry: SqlHistoryEntry,
  limit: number = SQL_HISTORY_LIMIT
): SqlHistoryEntry[] {
  const normalizedStatement = entry.statement.trim();
  const existingIndex = history.findIndex(
    (item) => item.statement.trim() === normalizedStatement
  );
  const preservedEntry = existingIndex >= 0 ? history[existingIndex] : null;
  const deduped =
    existingIndex >= 0
      ? [...history.slice(0, existingIndex), ...history.slice(existingIndex + 1)]
      : history;

  const mergedId = preservedEntry && preservedEntry.pinned ? preservedEntry.id : entry.id;
  const mergedPinned = preservedEntry?.pinned ?? entry.pinned ?? false;
  const mergedLabel = preservedEntry?.label ?? entry.label ?? null;
  const mergedStats = entry.stats ?? preservedEntry?.stats;
  const mergedUpdatedAt = entry.updatedAt ?? preservedEntry?.updatedAt ?? null;

  const mergedEntry: SqlHistoryEntry = {
    ...entry,
    id: mergedId,
    pinned: mergedPinned,
    label: mergedLabel,
    stats: mergedStats,
    updatedAt: mergedUpdatedAt
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
          createdAt: entry.createdAt ?? new Date().toISOString(),
          updatedAt: entry.updatedAt ?? null
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
  createdAt?: string;
  updatedAt?: string | null;
  stats?: SqlHistoryEntry['stats'];
}): SqlHistoryEntry {
  const { statement, rowCount, elapsedMs, label, pinned = false, id, createdAt, updatedAt, stats } = params;
  const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `sql_${Math.random().toString(36).slice(2, 10)}`;
  };

  const statsPayload = buildStats(stats, rowCount, elapsedMs);
  const createdAtIso = isValidTimestamp(createdAt) ? new Date(createdAt as string).toISOString() : new Date().toISOString();

  return {
    id: id ?? generateId(),
    statement,
    createdAt: createdAtIso,
    label: label ?? null,
    pinned,
    stats: statsPayload,
    updatedAt: isValidTimestamp(updatedAt) ? new Date(updatedAt as string).toISOString() : null
  };
}

function buildStats(
  stats: SqlHistoryEntry['stats'] | undefined,
  rowCount?: number,
  elapsedMs?: number
): SqlHistoryEntry['stats'] {
  if (stats && typeof stats === 'object') {
    return stats;
  }
  const candidate: NonNullable<SqlHistoryEntry['stats']> = {};
  if (typeof rowCount === 'number' && Number.isFinite(rowCount)) {
    candidate.rowCount = rowCount;
  }
  if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
    candidate.elapsedMs = elapsedMs;
  }
  return Object.keys(candidate).length > 0 ? candidate : undefined;
}

function isValidTimestamp(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  const time = Date.parse(value);
  return !Number.isNaN(time);
}
