import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import EventSchemaExplorer from '../EventSchemaExplorer';
import type { WorkflowEventSchema } from '../../../types';
import { ToastProvider } from '../../../../components/toast';

const SAMPLE_SCHEMA: WorkflowEventSchema = {
  totalSamples: 3,
  fields: [
    {
      path: ['payload'],
      jsonPath: '$.payload',
      liquidPath: 'event.payload',
      occurrences: 3,
      types: ['object'],
      kind: 'object',
      examples: []
    },
    {
      path: ['payload', 'user'],
      jsonPath: '$.payload.user',
      liquidPath: 'event.payload.user',
      occurrences: 3,
      types: ['object'],
      kind: 'object',
      examples: []
    },
    {
      path: ['payload', 'user', 'id'],
      jsonPath: '$.payload.user.id',
      liquidPath: 'event.payload.user.id',
      occurrences: 3,
      types: ['string'],
      kind: 'value',
      examples: ['u-123']
    }
  ]
};

describe('EventSchemaExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an empty state when no schema is available', () => {
    render(
      <ToastProvider>
        <EventSchemaExplorer schema={null} loading={false} />
      </ToastProvider>
    );
    expect(
      screen.getByText(/No schema information available yet/i)
    ).toBeInTheDocument();
  });

  it('renders field details and JSONPath when a node is selected', async () => {
    render(
      <ToastProvider>
        <EventSchemaExplorer schema={SAMPLE_SCHEMA} loading={false} />
      </ToastProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: '▸' })[0]);
    await user.click(screen.getByRole('button', { name: 'id' }));

    expect(screen.getByText('$.payload.user.id')).toBeInTheDocument();
    expect(screen.getByText('{{ event.payload.user.id }}')).toBeInTheDocument();
  });

  it('invokes predicate callbacks with generated snippets', async () => {
    const handlePredicate = vi.fn();
    render(
      <ToastProvider>
        <EventSchemaExplorer
          schema={SAMPLE_SCHEMA}
          loading={false}
          onAddPredicate={handlePredicate}
        />
      </ToastProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: '▸' })[0]);
    await user.click(screen.getByRole('button', { name: 'id' }));

    await user.click(screen.getByRole('button', { name: /Add exists predicate/i }));
    expect(handlePredicate).toHaveBeenCalledWith({ path: '$.payload.user.id', operator: 'exists' });

    await user.click(screen.getByRole('button', { name: /Add equals predicate/i }));
    expect(handlePredicate).toHaveBeenLastCalledWith({
      path: '$.payload.user.id',
      operator: 'equals',
      value: 'u-123'
    });
  });

  it('invokes liquid insertion callback with a quoted snippet', async () => {
    const handleInsert = vi.fn();
    render(
      <ToastProvider>
        <EventSchemaExplorer
          schema={SAMPLE_SCHEMA}
          loading={false}
          onInsertLiquid={handleInsert}
        />
      </ToastProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: '▸' })[0]);
    await user.click(screen.getByRole('button', { name: 'id' }));

    await user.click(screen.getByRole('button', { name: /Insert into template/i }));
    expect(handleInsert).toHaveBeenCalledWith('"{{ event.payload.user.id }}"');
  });

  it('disables snippet actions when the explorer is marked read-only', async () => {
    render(
      <ToastProvider>
        <EventSchemaExplorer
          schema={SAMPLE_SCHEMA}
          loading={false}
          disabled
          onAddPredicate={vi.fn()}
          onInsertLiquid={vi.fn()}
        />
      </ToastProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: '▸' })[0]);
    await user.click(screen.getByRole('button', { name: 'id' }));

    expect(screen.getByRole('button', { name: /Add exists predicate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add equals predicate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Insert into template/i })).toBeDisabled();
  });
});
