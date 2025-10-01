import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiBuilderSettingsContextValue } from '../../../ai/aiBuilderSettingsContext';
import type { SqlSchemaTable, TimestoreAiSqlSuggestion } from '../../types';
import { TimestoreAiQueryDialog } from '../TimestoreAiQueryDialog';

const generateSqlWithAiMock = vi.fn<
  [unknown, { prompt: string; schemaTables: SqlSchemaTable[]; provider: string; providerOptions?: Record<string, unknown> }],
  Promise<TimestoreAiSqlSuggestion>
>();
const toastHelpersMock = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  showToast: vi.fn(),
  showDestructiveSuccess: vi.fn(),
  showDestructiveError: vi.fn()
};

let aiSettingsMock: AiBuilderSettingsContextValue;

vi.mock('../../../ai/useAiBuilderSettings', () => ({
  useAiBuilderSettings: () => aiSettingsMock
}));

vi.mock('../../../components/toast', () => ({
  useToastHelpers: () => toastHelpersMock
}));

vi.mock('../../api', async () => {
  return {
    __esModule: true,
    generateSqlWithAi: (...args: unknown[]) => generateSqlWithAiMock(...args)
  };
});

const AUTHORIZED_FETCH = vi.fn();
const SCHEMA_TABLES: SqlSchemaTable[] = [
  {
    name: 'timestore_runtime.datasets',
    description: 'Datasets available to analysts',
    columns: [
      { name: 'dataset_slug', type: 'TEXT', description: 'Dataset identifier' },
      { name: 'row_count', type: 'INTEGER' }
    ]
  }
];

const BASE_SETTINGS: AiBuilderSettingsContextValue = {
  settings: {
    openAiApiKey: 'sk-test-123',
    preferredProvider: 'openai',
    openAiMaxOutputTokens: 4_096,
    openRouterApiKey: '',
    openRouterReferer: '',
    openRouterTitle: ''
  },
  hasOpenAiApiKey: true,
  hasOpenRouterApiKey: false,
  setOpenAiApiKey: vi.fn(),
  clearOpenAiApiKey: vi.fn(),
  setPreferredProvider: vi.fn(),
  setOpenAiMaxOutputTokens: vi.fn(),
  setOpenRouterApiKey: vi.fn(),
  clearOpenRouterApiKey: vi.fn(),
  setOpenRouterReferer: vi.fn(),
  setOpenRouterTitle: vi.fn()
};

describe('TimestoreAiQueryDialog', () => {
  beforeEach(() => {
    aiSettingsMock = { ...BASE_SETTINGS, settings: { ...BASE_SETTINGS.settings } };
    Object.values(toastHelpersMock).forEach((fn) => fn.mockClear?.());
    generateSqlWithAiMock.mockReset();
    AUTHORIZED_FETCH.mockReset();
  });

  it('submits prompt to OpenAI when configured', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();

    generateSqlWithAiMock.mockResolvedValue({
      sql: 'SELECT dataset_slug FROM timestore_runtime.datasets',
      notes: 'Lists dataset slugs',
      caveats: null,
      provider: 'openai',
      warnings: []
    });

    render(
      <TimestoreAiQueryDialog
        open
        onClose={onClose}
        schemaTables={SCHEMA_TABLES}
        authorizedFetch={AUTHORIZED_FETCH}
        onApply={onApply}
      />
    );

    await user.type(screen.getByPlaceholderText(/e\.g\./i), ' list datasets ');
    await user.click(screen.getByRole('button', { name: /generate query/i }));

    await waitFor(() => {
      expect(generateSqlWithAiMock).toHaveBeenCalledTimes(1);
    });

    expect(generateSqlWithAiMock).toHaveBeenCalledWith(AUTHORIZED_FETCH, {
      prompt: 'list datasets',
      schemaTables: SCHEMA_TABLES,
      provider: 'openai',
      providerOptions: {
        openAiApiKey: 'sk-test-123',
        openAiMaxOutputTokens: 4_096
      }
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'SELECT dataset_slug FROM timestore_runtime.datasets' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces credential error when no provider key is configured', async () => {
    const user = userEvent.setup();
    aiSettingsMock = {
      ...BASE_SETTINGS,
      hasOpenAiApiKey: false,
      settings: { ...BASE_SETTINGS.settings, openAiApiKey: '', preferredProvider: 'openai' }
    };

    render(
      <TimestoreAiQueryDialog
        open
        onClose={vi.fn()}
        schemaTables={SCHEMA_TABLES}
        authorizedFetch={AUTHORIZED_FETCH}
        onApply={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText(/e\.g\./i), 'list datasets');
    await user.click(screen.getByRole('button', { name: /generate query/i }));

    expect(screen.getByText(/add an openai api key/i)).toBeInTheDocument();
    expect(generateSqlWithAiMock).not.toHaveBeenCalled();
  });
});
