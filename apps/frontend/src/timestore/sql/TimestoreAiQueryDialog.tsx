import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthorizedFetch } from '../../lib/apiClient';
import { Modal } from '../../components';
import { useAiBuilderSettings } from '../../ai/useAiBuilderSettings';
import { useToastHelpers } from '../../components/toast';
import type { SqlSchemaTable, TimestoreAiSqlSuggestion } from '../types';
import {
  generateSqlWithAi,
  type TimestoreAiSqlProvider,
  type TimestoreAiSqlProviderOptions
} from '../api';
import {
  DIALOG_SURFACE,
  FIELD_LABEL,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  STATUS_BANNER_DANGER,
  TEXTAREA
} from '../timestoreTokens';

type ProviderChoice = {
  value: TimestoreAiSqlProvider;
  label: string;
  description: string;
};

const PROVIDER_CHOICES: ProviderChoice[] = [
  {
    value: 'openai',
    label: 'OpenAI GPT-5',
    description: 'High-quality reasoning with structured JSON output.'
  },
  {
    value: 'openrouter',
    label: 'Grok 4 (OpenRouter)',
    description: "xAI's Grok model via OpenRouter. Requires OpenRouter credentials."
  }
];

function providerNeedsKey(
  provider: TimestoreAiSqlProvider,
  hasOpenAiKey: boolean,
  hasOpenRouterKey: boolean
): boolean {
  if (provider === 'openai') {
    return !hasOpenAiKey;
  }
  return !hasOpenRouterKey;
}

function pickInitialProvider(
  preferred: TimestoreAiSqlProvider,
  hasOpenAiKey: boolean,
  hasOpenRouterKey: boolean
): TimestoreAiSqlProvider {
  if (preferred === 'openai' && hasOpenAiKey) {
    return 'openai';
  }
  if (preferred === 'openrouter' && hasOpenRouterKey) {
    return 'openrouter';
  }
  if (hasOpenAiKey) {
    return 'openai';
  }
  if (hasOpenRouterKey) {
    return 'openrouter';
  }
  return preferred;
}

export type TimestoreAiQueryDialogProps = {
  open: boolean;
  onClose: () => void;
  schemaTables: SqlSchemaTable[];
  authorizedFetch: AuthorizedFetch;
  onApply: (result: TimestoreAiSqlSuggestion) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function TimestoreAiQueryDialog({
  open,
  onClose,
  schemaTables,
  authorizedFetch,
  onApply,
  onBusyChange
}: TimestoreAiQueryDialogProps) {
  const aiSettings = useAiBuilderSettings();
  const { showError } = useToastHelpers();

  const hasOpenAiKey = aiSettings.hasOpenAiApiKey;
  const hasOpenRouterKey = aiSettings.hasOpenRouterApiKey;

  const normalizedPreferred = useMemo<TimestoreAiSqlProvider>(() => {
    return aiSettings.settings.preferredProvider === 'openrouter' ? 'openrouter' : 'openai';
  }, [aiSettings.settings.preferredProvider]);

  const initialProvider = useMemo(
    () => pickInitialProvider(normalizedPreferred, hasOpenAiKey, hasOpenRouterKey),
    [normalizedPreferred, hasOpenAiKey, hasOpenRouterKey]
  );

  const [provider, setProvider] = useState<TimestoreAiSqlProvider>(initialProvider);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPrompt('');
    setError(null);
    setProvider(pickInitialProvider(normalizedPreferred, hasOpenAiKey, hasOpenRouterKey));
  }, [open, normalizedPreferred, hasOpenAiKey, hasOpenRouterKey]);

  const busyGuard = useCallback(
    (value: boolean) => {
      onBusyChange?.(value);
      setSubmitting(value);
    },
    [onBusyChange]
  );

  const close = useCallback(() => {
    if (submitting) {
      return;
    }
    onClose();
  }, [onClose, submitting]);

  const dialogTitleId = 'timestore-ai-query-title';

  const handleProviderChange = useCallback(
    (next: TimestoreAiSqlProvider) => {
      setProvider(next);
      aiSettings.setPreferredProvider(next);
    },
    [aiSettings]
  );

  const buildProviderOptions = useCallback((): TimestoreAiSqlProviderOptions => {
    if (provider === 'openai') {
      return {
        openAiApiKey: aiSettings.settings.openAiApiKey,
        openAiMaxOutputTokens: aiSettings.settings.openAiMaxOutputTokens
      };
    }

    const normalized: TimestoreAiSqlProviderOptions = {
      openRouterApiKey: aiSettings.settings.openRouterApiKey,
      openRouterReferer: aiSettings.settings.openRouterReferer,
      openRouterTitle: aiSettings.settings.openRouterTitle
    };

    if (!normalized.openRouterReferer && typeof window !== 'undefined') {
      normalized.openRouterReferer = window.location?.origin;
    }
    if (!normalized.openRouterTitle && typeof document !== 'undefined') {
      normalized.openRouterTitle = document.title;
    }
    return normalized;
  }, [aiSettings.settings, provider]);

  const handleSubmit = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      if (submitting) {
        return;
      }

      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        setError('Describe what you want to learn from the data.');
        return;
      }

      const needsKey = providerNeedsKey(provider, hasOpenAiKey, hasOpenRouterKey);
      if (needsKey) {
        setError(
          provider === 'openai'
            ? 'Add an OpenAI API key in Settings → AI builder before requesting GPT-5.'
            : 'Add an OpenRouter API key in Settings → AI builder before using Grok.'
        );
        return;
      }

      const providerOptions = buildProviderOptions();

      setError(null);
      busyGuard(true);
      try {
        const result = await generateSqlWithAi(authorizedFetch, {
          prompt: trimmedPrompt,
          schemaTables,
          provider,
          providerOptions
        });
        onApply(result);
        setPrompt('');
        close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate SQL with AI.';
        setError(message);
        showError('AI generation failed', err);
      } finally {
        busyGuard(false);
      }
    },
    [
      authorizedFetch,
      buildProviderOptions,
      busyGuard,
      close,
      hasOpenAiKey,
      hasOpenRouterKey,
      onApply,
      prompt,
      provider,
      schemaTables,
      showError,
      submitting
    ]
  );

  return (
    <Modal open={open} onClose={close} labelledBy={dialogTitleId} contentClassName={DIALOG_SURFACE}>
      <form className="flex flex-col gap-6" onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit(event);
      }}>
        <header className="flex flex-col gap-2">
          <h2 id={dialogTitleId} className="text-scale-lg font-weight-semibold text-primary">
            Ask AI for a query
          </h2>
          <p className="text-scale-sm text-secondary">
            Explain the insight you need; GPT-5 will draft a DuckDB SQL query using the current schema snapshot.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>Provider</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROVIDER_CHOICES.map((choice) => {
                const disabled = choice.value === 'openai' ? !hasOpenAiKey : !hasOpenRouterKey;
                const active = provider === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => handleProviderChange(choice.value)}
                    disabled={disabled || submitting}
                    className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? 'border-accent bg-accent-soft text-primary'
                        : 'border-subtle bg-surface-glass-soft text-secondary hover:border-accent'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <div className="text-scale-sm font-weight-semibold">{choice.label}</div>
                    <div className="text-scale-xs text-muted">{choice.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>Prompt</span>
            <textarea
              className={`${TEXTAREA} min-h-[140px]`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. Compare yesterday’s ingest volume per dataset"
              disabled={submitting}
            />
          </label>

          {error && <div className={STATUS_BANNER_DANGER}>{error}</div>}
        </section>

        <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={close}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={submitting}>
            {submitting ? 'Generating…' : 'Generate query'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export default TimestoreAiQueryDialog;
