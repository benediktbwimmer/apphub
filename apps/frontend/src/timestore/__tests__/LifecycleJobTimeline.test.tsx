import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LifecycleJobTimeline } from '../components/LifecycleJobTimeline';
import type { LifecycleJobSummary } from '../types';

const JOB_FIXTURE: LifecycleJobSummary = {
  id: 'ljr-001',
  jobKind: 'dataset-maintenance',
  datasetId: 'ds-42',
  operations: ['compaction', 'retention'],
  status: 'completed',
  triggerSource: 'api',
  scheduledFor: null,
  startedAt: '2024-03-18T10:00:00.000Z',
  completedAt: '2024-03-18T10:05:00.000Z',
  durationMs: 300000,
  attempts: 1,
  error: null,
  metadata: {
    datasetSlug: 'telemetry.records',
    mode: 'inline',
    requestActorId: 'robot-one'
  },
  createdAt: '2024-03-18T10:00:00.000Z',
  updatedAt: '2024-03-18T10:05:00.000Z'
};

describe('LifecycleJobTimeline', () => {
  it('renders job entries with management controls', async () => {
    const user = userEvent.setup();
    const handleReschedule = vi.fn();

    render(
      <MemoryRouter>
        <LifecycleJobTimeline
          jobs={[JOB_FIXTURE]}
          loading={false}
          error={null}
          onRefresh={vi.fn()}
          onReschedule={handleReschedule}
          canManage
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Operations: compaction, retention/i)).toBeInTheDocument();
    expect(screen.getByText(/Dataset: telemetry.records/i)).toBeInTheDocument();
    expect(screen.getByText(/Actor: robot-one/i)).toBeInTheDocument();

    const rescheduleButton = screen.getByRole('button', { name: /reschedule/i });
    await user.click(rescheduleButton);
    expect(handleReschedule).toHaveBeenCalledWith('ljr-001');
  });

  it('hides management button when scope missing', () => {
    render(
      <MemoryRouter>
        <LifecycleJobTimeline
          jobs={[JOB_FIXTURE]}
          loading={false}
          error={null}
          onRefresh={vi.fn()}
          onReschedule={vi.fn()}
          canManage={false}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /reschedule/i })).not.toBeInTheDocument();
  });

  it('renders loading, error, and empty states', () => {
    const { rerender } = render(
      <MemoryRouter>
        <LifecycleJobTimeline
          jobs={[]}
          loading
          error={null}
          onRefresh={vi.fn()}
          onReschedule={vi.fn()}
          canManage
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading lifecycle jobs/i)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <LifecycleJobTimeline
          jobs={[]}
          loading={false}
          error="unable to load"
          onRefresh={vi.fn()}
          onReschedule={vi.fn()}
          canManage
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/unable to load/i)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <LifecycleJobTimeline
          jobs={[]}
          loading={false}
          error={null}
          onRefresh={vi.fn()}
          onReschedule={vi.fn()}
          canManage
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/No lifecycle activity recorded yet/i)).toBeInTheDocument();
  });
});
