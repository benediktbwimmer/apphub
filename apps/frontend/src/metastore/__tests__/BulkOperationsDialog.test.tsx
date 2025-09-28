import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BulkOperationsDialog } from '../components/BulkOperationsDialog';
import type { BulkRequestPayload, BulkResponsePayload } from '../types';
import { ToastProvider } from '../../components/toast';

describe('BulkOperationsDialog', () => {
  const noop = () => {};

  it('submits validated CSV payload and surfaces retry option', async () => {
    const csvInput = [
      'type,namespace,key,metadata,tags',
      'upsert,default,alpha,"{""foo"":""bar""}",tag-a|tag-b',
      'delete,default,beta,,'
    ].join('\n');

    const response: BulkResponsePayload = {
      operations: [
        { status: 'ok', namespace: 'default', key: 'alpha' },
        {
          status: 'error',
          namespace: 'default',
          key: 'beta',
          error: { message: 'Version mismatch' }
        }
      ]
    };

    const onSubmit = vi.fn<[BulkRequestPayload], Promise<BulkResponsePayload>>(async () => response);
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BulkOperationsDialog open onClose={noop} onSubmit={onSubmit} />
      </ToastProvider>
    );

    const textarea = screen.getByLabelText('Bulk operations CSV input');
    await user.clear(textarea);
    fireEvent.change(textarea, { target: { value: csvInput } });

    await user.click(screen.getByRole('button', { name: 'Validate payload' }));

    const continueButton = await screen.findByRole('button', { name: 'Continue to confirmation' });
    expect(continueButton).not.toBeDisabled();

    await user.click(continueButton);

    const submitButton = await screen.findByRole('button', { name: 'Submit bulk operations' });
    await user.click(submitButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const [payloadArg] = onSubmit.mock.calls[0];
    expect(payloadArg.operations).toHaveLength(2);
    expect(payloadArg.operations[0]).toMatchObject({
      type: 'upsert',
      namespace: 'default',
      key: 'alpha',
      metadata: { foo: 'bar' },
      tags: ['tag-a', 'tag-b']
    });
    expect(payloadArg.operations[1]).toMatchObject({
      type: 'delete',
      namespace: 'default',
      key: 'beta'
    });
    expect(payloadArg).not.toHaveProperty('continueOnError');

    await screen.findByRole('button', { name: 'Retry failed operations' });

    await user.click(screen.getByRole('button', { name: 'Retry failed operations' }));
    const rawTextarea = await screen.findByLabelText('Bulk operations raw JSON input');
    const retryPayload = JSON.parse(rawTextarea.value);
    expect(retryPayload.operations).toHaveLength(1);
    expect(retryPayload.operations[0]).toMatchObject({ type: 'delete', key: 'beta' });
  });

  it('prefills continue on error flag from raw JSON payload', async () => {
    const payload = {
      operations: [
        { type: 'delete', namespace: 'default', key: 'beta' }
      ],
      continueOnError: true
    };

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <BulkOperationsDialog open onClose={noop} onSubmit={async () => ({ operations: [] })} />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Raw JSON' }));
    const rawTextarea = screen.getByLabelText('Bulk operations raw JSON input');
    await user.clear(rawTextarea);
    fireEvent.change(rawTextarea, { target: { value: JSON.stringify(payload) } });

    await user.click(screen.getByRole('button', { name: 'Validate payload' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to confirmation' }));

    const continueCheckbox = await screen.findByRole('checkbox', { name: /Continue on error/ });
    expect(continueCheckbox).toBeChecked();
  });
});
