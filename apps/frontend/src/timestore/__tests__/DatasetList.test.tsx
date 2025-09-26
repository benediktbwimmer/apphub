import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatasetList } from '../components/DatasetList';
import type { DatasetRecord } from '../types';

const DATASET_FIXTURES: DatasetRecord[] = [
  {
    id: 'ds-1',
    slug: 'observatory.timeseries',
    displayName: 'Observatory Timeseries',
    description: null,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T12:00:00.000Z',
    storageTargetId: null,
    metadata: {}
  },
  {
    id: 'ds-2',
    slug: 'observatory.aggregate',
    displayName: null,
    description: null,
    status: 'inactive',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T12:00:00.000Z',
    storageTargetId: null,
    metadata: {}
  }
];

describe('DatasetList', () => {
  it('renders datasets and invokes selection callback', async () => {
    const user = userEvent.setup();
    const handleSelect = vi.fn();

    render(
      <DatasetList
        datasets={DATASET_FIXTURES}
        selectedId="ds-1"
        onSelect={handleSelect}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('Observatory Timeseries')).toBeInTheDocument();
    expect(screen.getByText('observatory.timeseries')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: /observatory\.aggregate/i });
    await user.click(buttons[0]);
    expect(handleSelect).toHaveBeenCalledWith('ds-2');
  });

  it('renders retry affordance when error present', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();

    render(
      <DatasetList
        datasets={[]}
        selectedId={null}
        onSelect={vi.fn()}
        loading={false}
        error="Failed to load"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(handleRetry).toHaveBeenCalled();
  });
});
