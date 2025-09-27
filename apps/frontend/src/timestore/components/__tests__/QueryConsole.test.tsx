import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryConsole } from '../QueryConsole';
import type { DatasetSchemaField } from '../../types';

const authorizedFetchMock = vi.fn();
const runDatasetQueryMock = vi.fn();
const toastHelpersMock = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  showToast: vi.fn(),
  showDestructiveSuccess: vi.fn(),
  showDestructiveError: vi.fn()
};

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../../api', () => ({
  __esModule: true,
  runDatasetQuery: (...args: unknown[]) => runDatasetQueryMock(...args)
}));

const SCHEMA_FIELDS: DatasetSchemaField[] = [
  { name: 'timestamp', type: 'timestamp' },
  { name: 'cpu_usage', type: 'double' },
  { name: 'memory_usage', type: 'double' },
  { name: 'region', type: 'string' }
];

beforeEach(() => {
  authorizedFetchMock.mockReset();
  runDatasetQueryMock.mockReset();
  Object.values(toastHelpersMock).forEach((fn) => fn.mockReset?.());
});

describe('QueryConsole', () => {
  it('submits downsample queries with multiple aggregations', async () => {
    const user = userEvent.setup();
    runDatasetQueryMock.mockResolvedValue({ rows: [], columns: [], mode: 'downsampled' });

    render(
      <QueryConsole
        datasetSlug="observability.cpu"
        defaultTimestampColumn="timestamp"
        schemaFields={SCHEMA_FIELDS}
        canQuery
      />
    );

    await user.click(screen.getByLabelText(/Enable downsampling/i));
    expect(screen.getByLabelText(/Enable downsampling/i)).toBeChecked();
    expect(screen.getAllByLabelText(/^Alias$/i).length).toBe(1);

    const firstAliasInput = screen.getAllByLabelText(/^Alias$/i)[0];
    await user.clear(firstAliasInput);
    await user.type(firstAliasInput, 'avg_cpu');

    await user.click(screen.getByRole('button', { name: /Add aggregation/i }));

    await waitFor(() => expect(screen.getAllByLabelText(/Aggregation/i).length).toBe(2));

    const aggregationSelects = screen.getAllByLabelText(/Aggregation/i);
    await user.selectOptions(aggregationSelects[1], 'percentile');

    const aliasInputs = screen.getAllByLabelText(/^Alias$/i);
    await user.clear(aliasInputs[1]);
    await user.type(aliasInputs[1], 'p95_cpu');

    const percentileInput = screen.getByLabelText(/Percentile/i);
    await user.clear(percentileInput);
    await user.type(percentileInput, '0.95');

    await user.click(screen.getByLabelText(/region/i));
    await user.click(screen.getByLabelText(/memory_usage/i));

    await user.click(screen.getByRole('button', { name: /Run query/i }));

    await waitFor(() => expect(runDatasetQueryMock).toHaveBeenCalledTimes(1));

    const [, slug, payload] = runDatasetQueryMock.mock.calls[0];
    expect(slug).toBe('observability.cpu');
    expect(payload).toMatchObject({
      timestampColumn: 'timestamp',
      columns: ['region', 'memory_usage'],
      downsample: {
        intervalUnit: 'minute',
        intervalSize: 5,
        aggregations: [
          { fn: 'avg', column: 'cpu_usage', alias: 'avg_cpu' },
          { fn: 'percentile', column: 'cpu_usage', alias: 'p95_cpu', percentile: 0.95 }
        ]
      }
    });
    expect((payload as Record<string, unknown>).timeRange).toMatchObject({
      start: expect.any(String),
      end: expect.any(String)
    });
  });

  it('prevents invalid percentile values', async () => {
    const user = userEvent.setup();
    runDatasetQueryMock.mockResolvedValue({ rows: [], columns: [], mode: 'downsampled' });

    render(
      <QueryConsole
        datasetSlug="observability.cpu"
        defaultTimestampColumn="timestamp"
        schemaFields={SCHEMA_FIELDS}
        canQuery
      />
    );

    await user.click(screen.getByLabelText(/Enable downsampling/i));
    expect(screen.getByLabelText(/Enable downsampling/i)).toBeChecked();

    const aggregationSelect = screen.getAllByLabelText(/Aggregation/i)[0];
    await user.selectOptions(aggregationSelect, 'percentile');
    expect(aggregationSelect).toHaveValue('percentile');

    const percentileInput = screen.getByLabelText(/Percentile/i);
    await user.clear(percentileInput);
    await user.type(percentileInput, '2');
    expect(percentileInput).toHaveValue(2);

    fireEvent.submit(screen.getByTestId('query-console-form'));

    await waitFor(() => {
      expect(toastHelpersMock.showError).toHaveBeenCalledWith(
        'Query validation failed',
        expect.objectContaining({ message: 'Percentile must be between 0 and 1 (exclusive).' })
      );
    });
    expect(runDatasetQueryMock).not.toHaveBeenCalled();
  });

  it('validates projection columns against the schema', async () => {
    const user = userEvent.setup();
    runDatasetQueryMock.mockResolvedValue({ rows: [], columns: [], mode: 'raw' });

    render(
      <QueryConsole
        datasetSlug="observability.cpu"
        defaultTimestampColumn="timestamp"
        schemaFields={SCHEMA_FIELDS}
        canQuery
      />
    );

    const addColumnInput = screen.getByPlaceholderText(/Add column/i);
    await user.type(addColumnInput, 'custom_metric');
    await user.click(screen.getByRole('button', { name: /^Add$/i }));

    await user.click(screen.getByRole('button', { name: /Run query/i }));

    expect(
      await screen.findByText(/Column "custom_metric" is not present in the dataset schema\./i)
    ).toBeInTheDocument();
    expect(runDatasetQueryMock).not.toHaveBeenCalled();
  });
});
