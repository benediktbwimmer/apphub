import { describe, expect, beforeEach, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilestoreHealthRail } from '../components/FilestoreHealthRail';
import type { MetastoreFilestoreHealth } from '../types';

function mockPollingResource() {
  return {
    data: null as MetastoreFilestoreHealth | null,
    error: null as unknown,
    loading: false,
    lastUpdatedAt: Date.now(),
    refetch: vi.fn(),
    stop: vi.fn()
  };
}

const mockPollingState: ReturnType<typeof mockPollingResource> = mockPollingResource();

const usePollingResourceMock = vi.fn(() => mockPollingState);

vi.mock('../../hooks/usePollingResource', () => ({
  usePollingResource: (options: unknown) => usePollingResourceMock(options)
}));

const baseHealth: MetastoreFilestoreHealth = {
  status: 'ok',
  enabled: true,
  inline: false,
  thresholdSeconds: 120,
  lagSeconds: 12,
  lastEvent: {
    type: 'filestore.node.updated',
    observedAt: '2024-04-01T10:00:00.000Z',
    receivedAt: '2024-04-01T10:00:05.000Z'
  },
  retries: {
    connect: 1,
    processing: 2,
    total: 3
  }
};

describe('FilestoreHealthRail', () => {
  beforeEach(() => {
    mockPollingState.data = { ...baseHealth };
    mockPollingState.error = null;
    mockPollingState.loading = false;
    mockPollingState.lastUpdatedAt = Date.now();
    usePollingResourceMock.mockClear();
  });

  it('renders health metrics and severity badge', () => {
    render(<FilestoreHealthRail enabled />);

    expect(screen.getByText(/filestore sync health/i)).toBeInTheDocument();
    expect(screen.getByText(/healthy/i)).toBeInTheDocument();
    expect(screen.getByText('12s')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('labels lag over threshold ratio as lagging', () => {
    mockPollingState.data = {
      ...baseHealth,
      lagSeconds: 80,
      thresholdSeconds: 100
    } satisfies MetastoreFilestoreHealth;

    render(<FilestoreHealthRail enabled />);

    expect(screen.getByText(/Lagging/i)).toBeInTheDocument();
  });

  it('shows access guidance when polling disabled', () => {
    mockPollingState.data = null;
    render(<FilestoreHealthRail enabled={false} />);

    expect(screen.getByText(/Provide a token/i)).toBeInTheDocument();
  });
});
