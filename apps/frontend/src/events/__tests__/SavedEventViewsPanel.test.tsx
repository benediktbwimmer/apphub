import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EventSavedViewRecord } from '@apphub/shared/eventsExplorer';
import SavedEventViewsPanel from '../SavedEventViewsPanel';

const mutationState = {
  creating: false,
  applyingSlug: null,
  sharingSlug: null,
  updatingSlug: null,
  deletingSlug: null
};

const noop = async () => {};

describe('SavedEventViewsPanel', () => {
  it('renders analytics and allows apply action', async () => {
    const first: EventSavedViewRecord = {
      id: 'view-1',
      slug: 'view-1',
      name: 'Critical alerts',
      description: 'Focus on urgent incidents',
      filters: { severity: ['critical'] },
      visibility: 'private',
      appliedCount: 3,
      sharedCount: 1,
      lastAppliedAt: null,
      lastSharedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerKey: 'user:alice',
      ownerSubject: 'user:alice',
      ownerKind: 'user',
      ownerUserId: 'alice',
      analytics: {
        windowSeconds: 900,
        totalEvents: 18,
        errorEvents: 4,
        eventRatePerMinute: 1.2,
        errorRatio: 4 / 18,
        generatedAt: '2025-01-02T00:00:00.000Z',
        sampledCount: 120,
        sampleLimit: 2000,
        truncated: false
      }
    };

    const onApply = vi.fn(() => Promise.resolve());

    render(
      <SavedEventViewsPanel
        savedViews={[first]}
        loading={false}
        error={null}
        mutationState={mutationState}
        viewerSubject="user:alice"
        onCreate={async () => {}}
        onApply={onApply}
        onRename={async () => {}}
        onDelete={async () => {}}
        onShare={async () => {}}
        activeSlug="view-1"
      />
    );

    expect(screen.getByText('Critical alerts')).toBeInTheDocument();
    expect(screen.getByText(/1\.2 events\/min/i)).toBeInTheDocument();
    expect(screen.getByText(/Error ratio/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText('Critical alerts'));
    expect(onApply).toHaveBeenCalled();
  });

  it('marks shared views from other owners and disables owner actions', () => {
    const sharedView: EventSavedViewRecord = {
      id: 'view-2',
      slug: 'view-2',
      name: 'Shared Ops View',
      description: null,
      filters: {},
      visibility: 'shared',
      appliedCount: 2,
      sharedCount: 5,
      lastAppliedAt: null,
      lastSharedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerKey: 'user:bob',
      ownerSubject: 'user:bob',
      ownerKind: 'user',
      ownerUserId: 'bob',
      analytics: null
    };

    render(
      <SavedEventViewsPanel
        savedViews={[sharedView]}
        loading={false}
        error={null}
        mutationState={mutationState}
        viewerSubject="user:alice"
        onCreate={noop}
        onApply={noop}
        onRename={noop}
        onDelete={noop}
        onShare={noop}
        activeSlug={null}
      />
    );

    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
  });
});
