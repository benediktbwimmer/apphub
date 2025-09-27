import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetCreateDialog from '../components/DatasetCreateDialog';
import type { CreateDatasetRequest } from '../types';

const toastHelpersMock = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  showToast: vi.fn(),
  showDestructiveSuccess: vi.fn(),
  showDestructiveError: vi.fn()
};

vi.mock('../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

describe('DatasetCreateDialog', () => {
  beforeEach(() => {
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
  });

  it('submits dataset metadata and closes on success', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn<(payload: CreateDatasetRequest) => Promise<void>>();
    onCreate.mockResolvedValue();
    const onClose = vi.fn();

    render(<DatasetCreateDialog open onClose={onClose} onCreate={onCreate} />);

    await user.type(screen.getByLabelText(/slug/i), 'observatory.events');
    await user.type(screen.getByLabelText(/name/i), 'Observatory Events');
    await user.type(screen.getByLabelText(/description/i), 'Event archive dataset');
    await user.type(screen.getByLabelText(/default storage target/i), 'st-42');
    await user.selectOptions(screen.getByLabelText(/write format/i), 'parquet');
    await user.selectOptions(screen.getByLabelText(/status/i), 'inactive');
    await user.type(screen.getByLabelText(/^read scopes/i), 'timestore:read\nobservatory:read');
    await user.type(screen.getByLabelText(/^write scopes/i), 'timestore:write');

    await user.click(screen.getByRole('button', { name: /create dataset/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    expect(onCreate).toHaveBeenCalledWith({
      slug: 'observatory.events',
      name: 'Observatory Events',
      description: 'Event archive dataset',
      status: 'inactive',
      writeFormat: 'parquet',
      defaultStorageTargetId: 'st-42',
      metadata: {
        iam: {
          readScopes: ['timestore:read', 'observatory:read'],
          writeScopes: ['timestore:write']
        }
      }
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(toastHelpersMock.showSuccess).toHaveBeenCalledWith(
      'Dataset created',
      expect.stringContaining('observatory.events')
    );
  });

  it('shows validation errors when required fields are missing', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<DatasetCreateDialog open onClose={vi.fn()} onCreate={onCreate} />);

    await user.click(screen.getByRole('button', { name: /create dataset/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/slug may only include letters, numbers, dashes, underscores, and dots/i)).toBeInTheDocument();
    expect(screen.getByText(/string must contain at least 1 character/i)).toBeInTheDocument();
  });

  it('surfaces API errors from onCreate', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error('Request failed'));
    const onClose = vi.fn();

    render(<DatasetCreateDialog open onClose={onClose} onCreate={onCreate} />);

    await user.type(screen.getByLabelText(/slug/i), 'observatory.events');
    await user.type(screen.getByLabelText(/name/i), 'Observatory Events');

    await user.click(screen.getByRole('button', { name: /create dataset/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(toastHelpersMock.showError).toHaveBeenCalledWith('Create dataset failed', expect.any(Error));
    expect(screen.getByText('Request failed')).toBeInTheDocument();
  });
});
