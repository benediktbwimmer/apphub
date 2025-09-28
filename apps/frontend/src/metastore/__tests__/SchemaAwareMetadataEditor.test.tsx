import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SchemaAwareMetadataEditor from '../components/SchemaAwareMetadataEditor';
import type { SchemaDefinitionHookState } from '../useSchemaDefinition';
import type { MetastoreSchemaDefinition } from '../types';

const baseSchema: MetastoreSchemaDefinition = {
  schemaHash: 'sha256:abc123',
  name: 'Test Schema',
  description: 'Schema description',
  version: '1.0.0',
  metadata: { docsUrl: 'https://example.com/docs' },
  fields: [
    {
      path: 'name',
      type: 'string',
      description: 'Display name',
      required: true
    },
    {
      path: 'details.age',
      type: 'integer',
      description: 'Age in years'
    },
    {
      path: 'flags.active',
      type: 'boolean'
    }
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  cache: 'database'
};

const readyState: SchemaDefinitionHookState = {
  status: 'ready',
  schema: baseSchema,
  loading: false,
  error: null,
  missingMessage: null
};

describe('SchemaAwareMetadataEditor', () => {
  it('renders structured form and updates metadata state', async () => {
    const onDraftChange = vi.fn();
    const onTextChange = vi.fn();
    const onModeChange = vi.fn();
    const onParseErrorChange = vi.fn();
    const onValidationChange = vi.fn();

    const user = userEvent.setup();

    render(
      <SchemaAwareMetadataEditor
        schemaHash={baseSchema.schemaHash}
        schemaState={readyState}
        metadataMode="schema"
        onMetadataModeChange={onModeChange}
        metadataDraft={{ name: 'Original', flags: { active: true }, legacy: 'keep-me' }}
        onMetadataDraftChange={onDraftChange}
        metadataText='{ "name": "Original" }'
        onMetadataTextChange={onTextChange}
        parseError={null}
        onParseErrorChange={onParseErrorChange}
        onValidationChange={onValidationChange}
        hasWriteScope
      />
    );

    const nameInput = screen.getByLabelText(/name • required/i);
    await user.clear(nameInput);
    expect(onValidationChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'This field is required' }));

    fireEvent.change(nameInput, { target: { value: 'Updated' } });

    const lastDraft = onDraftChange.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastDraft).toMatchObject({ name: 'Updated' });

    const lastTextInvocation = onTextChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(lastTextInvocation).toContain('"Updated"');
    expect(screen.getByText('legacy')).toBeInTheDocument();
  });

  it('switches between modes and surfaces JSON parse errors', async () => {
    const onDraftChange = vi.fn();
    const onTextChange = vi.fn();
    const onModeChange = vi.fn();
    const onParseErrorChange = vi.fn();
    const onValidationChange = vi.fn();

    const user = userEvent.setup();

    const { rerender } = render(
      <SchemaAwareMetadataEditor
        schemaHash={baseSchema.schemaHash}
        schemaState={readyState}
        metadataMode="schema"
        onMetadataModeChange={onModeChange}
        metadataDraft={{ name: 'Original' }}
        onMetadataDraftChange={onDraftChange}
        metadataText='{ "name": "Original" }'
        onMetadataTextChange={onTextChange}
        parseError={null}
        onParseErrorChange={onParseErrorChange}
        onValidationChange={onValidationChange}
        hasWriteScope
      />
    );

    await user.click(screen.getByRole('button', { name: /Raw JSON/i }));
    expect(onModeChange).toHaveBeenCalledWith('json');
    expect(onTextChange).toHaveBeenCalledWith(expect.stringContaining('"Original"'));

    rerender(
      <SchemaAwareMetadataEditor
        schemaHash={baseSchema.schemaHash}
        schemaState={readyState}
        metadataMode="json"
        onMetadataModeChange={onModeChange}
        metadataDraft={{ name: 'Original' }}
        onMetadataDraftChange={onDraftChange}
        metadataText="{ invalid"
        onMetadataTextChange={onTextChange}
        parseError="Invalid metadata JSON"
        onParseErrorChange={onParseErrorChange}
        onValidationChange={onValidationChange}
        hasWriteScope
      />
    );

    await user.click(screen.getByRole('button', { name: /Structured form/i }));
    const errorMessage = onParseErrorChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(errorMessage).toMatch(/Invalid metadata JSON|Expected property name/i);
    expect(onModeChange).not.toHaveBeenCalledWith('schema');
  });

  it('shows schema loading and missing states', () => {
    const loadingState: SchemaDefinitionHookState = {
      status: 'loading',
      schema: null,
      loading: true,
      error: null,
      missingMessage: null
    };

    const missingState: SchemaDefinitionHookState = {
      status: 'missing',
      schema: null,
      loading: false,
      error: null,
      missingMessage: 'Schema metadata not registered.'
    };

    const { rerender } = render(
      <SchemaAwareMetadataEditor
        schemaHash={baseSchema.schemaHash}
        schemaState={loadingState}
        metadataMode="json"
        onMetadataModeChange={vi.fn()}
        metadataDraft={{}}
        onMetadataDraftChange={vi.fn()}
        metadataText="{}"
        onMetadataTextChange={vi.fn()}
        parseError={null}
        onParseErrorChange={vi.fn()}
        onValidationChange={vi.fn()}
        hasWriteScope
      />
    );

    expect(screen.getByText(/Loading schema/i)).toBeInTheDocument();

    rerender(
      <SchemaAwareMetadataEditor
        schemaHash={baseSchema.schemaHash}
        schemaState={missingState}
        metadataMode="json"
        onMetadataModeChange={vi.fn()}
        metadataDraft={{}}
        onMetadataDraftChange={vi.fn()}
        metadataText="{}"
        onMetadataTextChange={vi.fn()}
        parseError={null}
        onParseErrorChange={vi.fn()}
        onValidationChange={vi.fn()}
        hasWriteScope
      />
    );

    expect(screen.getByText('Schema metadata not registered.')).toBeInTheDocument();
  });
});
