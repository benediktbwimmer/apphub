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
