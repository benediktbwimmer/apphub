import { describe, expect, it, vi } from 'vitest';
import {
  SQL_HISTORY_LIMIT,
  SQL_HISTORY_STORAGE_KEY,
  addHistoryEntry,
  clearUnpinnedHistory,
  createHistoryEntry,
  readHistoryFromStorage,
  removeHistoryEntry,
  updateHistoryEntry,
  writeHistoryToStorage
} from '../sqlHistory';

describe('sqlHistory utilities', () => {
  it('adds entries with recency ordering and deduplication', () => {
    const first = createHistoryEntry({ statement: 'select 1' });
    const history = addHistoryEntry([], first);
    expect(history).toHaveLength(1);

    const second = createHistoryEntry({ statement: 'select * from foo' });
    const updated = addHistoryEntry(history, second);
    expect(updated[0]?.statement).toBe(second.statement);
    expect(updated[1]?.statement).toBe(first.statement);

    const duplicate = createHistoryEntry({ statement: 'select * from foo' });
    const deduped = addHistoryEntry(updated, duplicate);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.statement).toBe(duplicate.statement);
  });

  it('honours pinning and limit when adding entries', () => {
    const pinned = createHistoryEntry({ statement: 'select 1', pinned: true });
    let history = addHistoryEntry([], pinned);
    expect(history[0]?.pinned).toBe(true);

    for (let index = 0; index < SQL_HISTORY_LIMIT; index += 1) {
      history = addHistoryEntry(history, createHistoryEntry({ statement: `select ${index}` }));
    }
    expect(history.length).toBeLessThanOrEqual(SQL_HISTORY_LIMIT);
    expect(history[0]?.pinned).toBe(true);
  });

  it('updates, removes, and clears entries', () => {
    const entry = createHistoryEntry({ statement: 'select 1' });
    let history = addHistoryEntry([], entry);

    history = updateHistoryEntry(history, entry.id, { pinned: true });
    expect(history[0]?.pinned).toBe(true);

    history = clearUnpinnedHistory(history);
    expect(history).toHaveLength(1);

    history = removeHistoryEntry(history, entry.id);
    expect(history).toHaveLength(0);
  });

  it('reads and writes history from storage safely', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const storage = {
      getItem,
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0
    } as unknown as Storage;

    expect(readHistoryFromStorage(storage)).toEqual([]);

    const entry = createHistoryEntry({ statement: 'select 1' });
    writeHistoryToStorage(storage, [entry]);
    expect(setItem).toHaveBeenCalledWith(SQL_HISTORY_STORAGE_KEY, expect.any(String));

    getItem.mockReturnValue(setItem.mock.calls[0]?.[1]);
    const loaded = readHistoryFromStorage(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.statement).toBe(entry.statement);
  });
});
