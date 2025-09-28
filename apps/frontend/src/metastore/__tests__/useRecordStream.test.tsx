import { describe, expect, beforeEach, afterEach, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMetastoreRecordStream } from '../useRecordStream';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    activeToken: null,
    setActiveToken: vi.fn(),
    identity: null,
    identityLoading: false,
    identityError: null,
    refreshIdentity: vi.fn(),
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    refreshApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn()
  })
}));

type Listener = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials: boolean;
  readyState: number = MockEventSource.CONNECTING;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as Listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    set.delete(listener as Listener);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  emitOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.call(this as unknown as EventSource, new Event('open'));
  }

  emitError({ close = false }: { close?: boolean } = {}) {
    if (close) {
      this.readyState = MockEventSource.CLOSED;
    } else {
      this.readyState = MockEventSource.CONNECTING;
    }
    this.onerror?.call(this as unknown as EventSource, new Event('error'));
  }

  emit(type: string, data: unknown, options: { lastEventId?: string | null } = {}) {
    const payload: MessageEvent<string> = {
      data: JSON.stringify(data),
      lastEventId: options.lastEventId ?? null
    } as MessageEvent<string>;
    this.listeners.get(type)?.forEach((listener) => listener(payload));
    if (type !== 'message') {
      this.listeners.get('message')?.forEach((listener) => listener(payload));
    }
  }
}

describe('useMetastoreRecordStream', () => {
  const original = globalThis.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (!original) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (globalThis as { EventSource?: unknown }).EventSource;
    }
  });

  it('captures stream events and maintains ordering', async () => {
    const { result } = renderHook(() => useMetastoreRecordStream({ enabled: true, eventLimit: 5 }));

    expect(result.current.status).toBe('connecting');

    const instance = MockEventSource.instances[0];
    expect(instance).toBeDefined();

    act(() => {
      instance.emitOpen();
    });

    await waitFor(() => expect(result.current.status).toBe('open'));

    const basePayload = {
      namespace: 'default',
      key: 'record-a',
      version: 2,
      occurredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      actor: 'tester',
      mode: 'soft'
    } as const;

    act(() => {
      instance.emit('metastore.record.created', { action: 'created', ...basePayload }, { lastEventId: '1' });
      instance.emit('metastore.record.updated', { action: 'updated', ...basePayload, version: 3 }, { lastEventId: '2' });
    });

    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.events[0].payload.action).toBe('updated');
    expect(result.current.events[1].payload.action).toBe('created');
  });

  it('ignores duplicate event ids', async () => {
    const { result } = renderHook(() => useMetastoreRecordStream({ enabled: true }));
    const instance = MockEventSource.instances[0];

    act(() => {
      instance.emitOpen();
    });

    await waitFor(() => expect(result.current.status).toBe('open'));

    const payload = {
      action: 'created',
      namespace: 'default',
      key: 'dup-record',
      version: 1,
      occurredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      actor: null,
      mode: 'soft'
    } as const;

    act(() => {
      instance.emit('metastore.record.created', payload, { lastEventId: 'dup-1' });
      instance.emit('metastore.record.created', payload, { lastEventId: 'dup-1' });
    });

    await waitFor(() => expect(result.current.events.length).toBe(1));
  });

  it('reports disconnection and schedules reconnect', async () => {
    const { result } = renderHook(() => useMetastoreRecordStream({ enabled: true }));
    const instance = MockEventSource.instances[0];

    act(() => {
      instance.emitOpen();
    });

    await waitFor(() => expect(result.current.status).toBe('open'));

    vi.useFakeTimers();

    act(() => {
      instance.emitError({ close: true });
    });

    expect(result.current.status).toBe('error');

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    vi.useRealTimers();

    // A new EventSource should be created for the reconnect attempt.
    expect(MockEventSource.instances.length).toBeGreaterThan(1);
  });
});
