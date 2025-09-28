import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RealtimeActivityRail } from '../components/RealtimeActivityRail';
import type { MetastoreStreamEntry } from '../useRecordStream';

const mockStreamState: {
  events: MetastoreStreamEntry[];
  status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';
  error: string | null;
} = {
  events: [],
  status: 'open',
  error: null
};

const mockUseMetastoreRecordStream = vi.fn(() => mockStreamState);

vi.mock('../useRecordStream', () => ({
  useMetastoreRecordStream: (options: unknown) => mockUseMetastoreRecordStream(options)
}));

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    activeToken: 'debug-token',
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

function buildEntry(overrides: Partial<MetastoreStreamEntry> = {}): MetastoreStreamEntry {
  const payload = {
    action: 'created' as const,
    namespace: 'default',
    key: 'alpha',
    version: 1,
    occurredAt: new Date('2024-04-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2024-04-01T10:00:00Z').toISOString(),
    deletedAt: null,
    actor: 'tester',
    mode: 'soft' as const,
    ...(overrides.payload ?? {})
  };
  return {
    id: 'evt-1',
    eventType: `metastore.record.${payload.action}`,
    receivedAt: new Date('2024-04-01T10:00:01Z').toISOString(),
    payload,
    ...overrides
  };
}

describe('RealtimeActivityRail', () => {
  beforeEach(() => {
    mockStreamState.events = [];
    mockStreamState.status = 'open';
    mockStreamState.error = null;
    mockUseMetastoreRecordStream.mockClear();
  });

  it('renders events for the active namespace', () => {
    mockStreamState.events = [
      buildEntry({ id: 'evt-1', payload: { key: 'alpha', namespace: 'default' } }),
      buildEntry({
        id: 'evt-2',
        payload: { action: 'updated', key: 'beta', namespace: 'other', version: 2 }
      })
    ];

    render(<RealtimeActivityRail namespace="default" enabled />);

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
  });

  it('queues events while paused and catches up on resume', () => {
    mockStreamState.events = [buildEntry({ id: 'evt-1', payload: { key: 'alpha' } })];

    const { rerender } = render(<RealtimeActivityRail namespace="default" enabled />);

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    mockStreamState.events = [
      buildEntry({ id: 'evt-1', payload: { key: 'alpha' } }),
      buildEntry({ id: 'evt-2', payload: { key: 'beta', namespace: 'default' } })
    ];

    rerender(<RealtimeActivityRail namespace="default" enabled />);

    expect(screen.getByText(/1 new event while paused/i)).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /catch up/i }));

    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.queryByText(/1 new event while paused/i)).not.toBeInTheDocument();
  });

  it('shows diagnostic guidance', () => {
    render(<RealtimeActivityRail namespace="default" enabled />);
    expect(screen.getByText(/copy curl command/i)).toBeInTheDocument();
  });
});
