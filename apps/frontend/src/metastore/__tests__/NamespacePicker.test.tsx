import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorizedFetchMock = vi.fn();
const showErrorMock = vi.fn();

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => ({
    showError: showErrorMock,
    showSuccess: vi.fn(),
    showInfo: vi.fn()
  })
}));

vi.mock('../api', () => ({
  listNamespaces: vi.fn()
}));

import { NamespacePicker } from '../components/NamespacePicker';
import { listNamespaces } from '../api';
import type { MetastoreNamespaceSummary } from '../types';

type NamespaceResponse = {
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
  namespaces: MetastoreNamespaceSummary[];
};

const listNamespacesMock = vi.mocked(listNamespaces);

function buildResponse(entries: MetastoreNamespaceSummary[]): NamespaceResponse {
  return {
    pagination: {
      total: entries.length,
      limit: 50,
      offset: 0
    },
    namespaces: entries
  } satisfies NamespaceResponse;
}

function Wrapper({ initial, onSelect }: { initial: string; onSelect?: (value: string) => void }) {
  const [current, setCurrent] = useState(initial);
  return (
    <NamespacePicker
      value={current}
      onChange={(next) => {
        setCurrent(next);
        onSelect?.(next);
      }}
    />
  );
}

beforeEach(() => {
  authorizedFetchMock.mockReset();
  authorizedFetchMock.mockImplementation(async () => new Response('{}'));
  listNamespacesMock.mockReset();
  showErrorMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NamespacePicker', () => {
  it('renders discovered namespaces and records recent selections', async () => {
    listNamespacesMock.mockResolvedValue(
      buildResponse([
        {
          name: 'default',
          totalRecords: 3,
          deletedRecords: 0,
          lastUpdatedAt: '2024-01-01T00:00:00.000Z'
        },
        {
          name: 'analytics',
          totalRecords: 42,
          deletedRecords: 5,
          lastUpdatedAt: '2024-01-02T00:00:00.000Z'
        }
      ])
    );

    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Wrapper initial="default" onSelect={onSelect} />
      </MemoryRouter>
    );

    await waitFor(() => expect(listNamespacesMock).toHaveBeenCalled());

    const control = screen.getByRole('button', { name: /namespace/i });
    await user.click(control);

    const analyticsText = await screen.findByText('analytics');
    await user.click(analyticsText.closest('button')!);

    expect(onSelect).toHaveBeenCalledWith('analytics');

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('apphub.metastore.namespaceRecents') ?? '[]');
      expect(stored).toEqual(['analytics']);
    });

    const reopenedControl = screen.getByRole('button', { name: /namespace/i });
    await user.click(reopenedControl);
    expect(await screen.findByText(/recent/i)).toBeInTheDocument();
  });

  it('allows starring favorites and persists them across renders', async () => {
    listNamespacesMock.mockResolvedValue(
      buildResponse([
        {
          name: 'default',
          totalRecords: 1,
          deletedRecords: 0,
          lastUpdatedAt: '2024-01-01T00:00:00.000Z'
        },
        {
          name: 'analytics',
          totalRecords: 24,
          deletedRecords: 1,
          lastUpdatedAt: '2024-01-02T00:00:00.000Z'
        }
      ])
    );

    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <Wrapper initial="default" />
      </MemoryRouter>
    );

    await waitFor(() => expect(listNamespacesMock).toHaveBeenCalled());

    const control = screen.getByRole('button', { name: /namespace/i });
    await user.click(control);

    const starButton = await screen.findByRole('button', { name: /add analytics to favorites/i });
    await user.click(starButton);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('apphub.metastore.namespaceFavorites') ?? '[]');
      expect(stored).toEqual(['analytics']);
    });

    expect(await screen.findByText(/favorites/i)).toBeInTheDocument();

    unmount();

    listNamespacesMock.mockClear();
    listNamespacesMock.mockResolvedValue(
      buildResponse([
        {
          name: 'default',
          totalRecords: 1,
          deletedRecords: 0,
          lastUpdatedAt: '2024-01-01T00:00:00.000Z'
        },
        {
          name: 'analytics',
          totalRecords: 24,
          deletedRecords: 1,
          lastUpdatedAt: '2024-01-02T00:00:00.000Z'
        }
      ])
    );

    render(
      <MemoryRouter>
        <Wrapper initial="default" />
      </MemoryRouter>
    );

    await waitFor(() => expect(listNamespacesMock).toHaveBeenCalled());

    const reopenedControl = screen.getByRole('button', { name: /namespace/i });
    await user.click(reopenedControl);
    expect(await screen.findByText(/favorites/i)).toBeInTheDocument();
    expect(screen.getByText('analytics')).toBeInTheDocument();
  });

  it('falls back to manual entry when discovery fails and recovers on retry', async () => {
    listNamespacesMock.mockRejectedValueOnce(new Error('boom'));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Wrapper initial="default" />
      </MemoryRouter>
    );

    await waitFor(() => expect(showErrorMock).toHaveBeenCalled());

    expect(screen.getByRole('textbox', { name: /namespace/i })).toBeInTheDocument();

    listNamespacesMock.mockResolvedValueOnce(
      buildResponse([
        {
          name: 'default',
          totalRecords: 1,
          deletedRecords: 0,
          lastUpdatedAt: '2024-01-01T00:00:00.000Z'
        }
      ])
    );

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(listNamespacesMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /namespace/i })).toBeInTheDocument();
  });

  it('highlights unauthorized namespaces with guidance', async () => {
    listNamespacesMock.mockResolvedValue(
      buildResponse([
        {
          name: 'default',
          totalRecords: 1,
          deletedRecords: 0,
          lastUpdatedAt: '2024-01-01T00:00:00.000Z'
        }
      ])
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Wrapper initial="secret" />
      </MemoryRouter>
    );

    await waitFor(() => expect(listNamespacesMock).toHaveBeenCalled());

    expect(screen.getByText(/No access to secret/i)).toBeInTheDocument();

    const control = screen.getByRole('button', { name: /namespace/i });
    await user.click(control);
    expect(screen.getByRole('link', { name: /manage scopes/i })).toBeInTheDocument();
  });
});
