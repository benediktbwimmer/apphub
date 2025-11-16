import '@testing-library/jest-dom/vitest';

window.scrollTo = window.scrollTo ?? (() => {});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!(window as unknown as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver) {
  (window as unknown as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

// Ensure a workable localStorage in environments where Node's flag-based storage is unavailable.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
}
