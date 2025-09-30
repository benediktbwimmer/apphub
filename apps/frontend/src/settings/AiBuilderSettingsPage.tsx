import classNames from 'classnames';
import { useEffect, useMemo, useState, type FormEventHandler } from 'react';
import { useAiBuilderSettings } from '../ai/useAiBuilderSettings';
import type { AiBuilderProvider } from '../ai/types';
import {
  SETTINGS_CARD_CONTAINER_CLASSES,
  SETTINGS_FORM_INPUT_CLASSES,
  SETTINGS_FORM_LABEL_CLASSES,
  SETTINGS_PRIMARY_BUTTON_CLASSES,
  SETTINGS_SECONDARY_BUTTON_CLASSES,
  SETTINGS_SECTION_HELPER_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
  SETTINGS_SECTION_TITLE_CLASSES
} from './settingsTokens';

const PROVIDER_OPTIONS: ReadonlyArray<{ value: AiBuilderProvider; label: string; description: string }> = [
  {
    value: 'codex',
    label: 'Codex CLI (host proxy)',
    description: 'Use the existing Codex CLI via the host proxy. Requires the proxy service to be running.'
  },
  {
    value: 'openai',
    label: 'OpenAI GPT-5',
    description: 'Call OpenAI\'s GPT-5 model with high reasoning effort. Requires an API key saved below.'
  },
  {
    value: 'openrouter',
    label: 'Grok 4 (OpenRouter)',
    description: 'Use OpenRouter to access xAI\'s Grok 4 fast model. Requires an OpenRouter API key saved below.'
  }
];

type Feedback = { tone: 'success' | 'error'; message: string } | null;

export default function AiBuilderSettingsPage() {
  const {
    settings,
    hasOpenAiApiKey,
    hasOpenRouterApiKey,
    setOpenAiApiKey,
    clearOpenAiApiKey,
    setPreferredProvider,
    setOpenAiMaxOutputTokens,
    setOpenRouterApiKey,
    clearOpenRouterApiKey,
    setOpenRouterReferer,
    setOpenRouterTitle
  } = useAiBuilderSettings();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [openRouterKeyDraft, setOpenRouterKeyDraft] = useState('');
  const [openRouterRefererDraft, setOpenRouterRefererDraft] = useState(settings.openRouterReferer);
  const [openRouterTitleDraft, setOpenRouterTitleDraft] = useState(settings.openRouterTitle);
  const [tokenDraft, setTokenDraft] = useState(() => settings.openAiMaxOutputTokens.toString());
  const [feedback, setFeedback] = useState<Feedback>(null);

  const providerLabelMap = useMemo(() => {
    return new Map(PROVIDER_OPTIONS.map((option) => [option.value, option.label] as const));
  }, []);

  useEffect(() => {
    setTokenDraft(settings.openAiMaxOutputTokens.toString());
  }, [settings.openAiMaxOutputTokens]);

  useEffect(() => {
    setOpenRouterRefererDraft(settings.openRouterReferer);
    setOpenRouterTitleDraft(settings.openRouterTitle);
  }, [settings.openRouterReferer, settings.openRouterTitle]);

  const handleSaveKey: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      setFeedback({ tone: 'error', message: 'Enter a valid API key before saving.' });
      return;
    }
    setOpenAiApiKey(trimmed);
    setApiKeyDraft('');
    setFeedback({ tone: 'success', message: 'OpenAI API key saved to your browser.' });
  };

  const handleClearKey = () => {
    clearOpenAiApiKey();
    setFeedback({ tone: 'success', message: 'OpenAI API key removed from this browser.' });
  };

  const handleProviderChange = (provider: AiBuilderProvider) => {
    setPreferredProvider(provider);
    const label = providerLabelMap.get(provider) ?? provider;
    setFeedback({ tone: 'success', message: `Preferred provider set to ${label}.` });
  };

  const maxTokenBounds = useMemo(() => ({ min: 256, max: 32_000, step: 256 }), []);

  const handleSaveTokens = () => {
    const parsed = Number.parseInt(tokenDraft, 10);
    if (!Number.isFinite(parsed) || parsed < maxTokenBounds.min || parsed > maxTokenBounds.max) {
      setFeedback({
        tone: 'error',
        message: `Enter a value between ${maxTokenBounds.min} and ${maxTokenBounds.max} tokens.`
      });
      return;
    }
    setOpenAiMaxOutputTokens(parsed);
    setFeedback({ tone: 'success', message: 'Max output tokens updated.' });
  };

  const handleSaveOpenRouterKey: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = openRouterKeyDraft.trim();
    if (!trimmed) {
      setFeedback({ tone: 'error', message: 'Enter a valid OpenRouter API key before saving.' });
      return;
    }
    setOpenRouterApiKey(trimmed);
    setOpenRouterKeyDraft('');
    setFeedback({ tone: 'success', message: 'OpenRouter API key saved to your browser.' });
  };

  const handleClearOpenRouterKey = () => {
    clearOpenRouterApiKey();
    setFeedback({ tone: 'success', message: 'OpenRouter API key removed from this browser.' });
  };

  const handleSaveOpenRouterMetadata = () => {
    setOpenRouterReferer(openRouterRefererDraft.trim());
    setOpenRouterTitle(openRouterTitleDraft.trim());
    setFeedback({ tone: 'success', message: 'OpenRouter site metadata updated.' });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className={SETTINGS_SECTION_TITLE_CLASSES}>AI builder configuration</h2>
        <p className={SETTINGS_SECTION_HELPER_CLASSES}>
          Store provider credentials locally and choose the default engine for workflow generations. Keys never leave your browser until you trigger a generation request.
        </p>
      </header>

      <section className={SETTINGS_CARD_CONTAINER_CLASSES}>
        <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>Default provider</h3>
        <p className={SETTINGS_SECTION_HELPER_CLASSES}>
          The AI builder will start with this provider when you open the dialog. You can still switch providers on each run.
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {PROVIDER_OPTIONS.map((option) => {
            const active = settings.preferredProvider === option.value;
            return (
              <label
                key={option.value}
                className={classNames(
                  'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-scale-sm transition-colors',
                  active
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft/50'
                )}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="ai-provider"
                    value={option.value}
                    checked={active}
                    onChange={() => handleProviderChange(option.value)}
                    className="h-4 w-4 text-accent focus:ring-accent"
                  />
                  <span className="font-semibold">{option.label}</span>
                </span>
                <span className={classNames('pl-7 text-scale-xs', SETTINGS_SECTION_HELPER_CLASSES)}>{option.description}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <label className={SETTINGS_SECTION_LABEL_CLASSES}>
            OpenAI max output tokens
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={maxTokenBounds.min}
                max={maxTokenBounds.max}
                step={maxTokenBounds.step}
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                className={classNames(SETTINGS_FORM_INPUT_CLASSES, 'w-32')}
                inputMode="numeric"
              />
              <button
                type="button"
                className={SETTINGS_SECONDARY_BUTTON_CLASSES}
                onClick={handleSaveTokens}
              >
                Save
              </button>
              <span className={SETTINGS_SECTION_HELPER_CLASSES}>
                Used when generating with OpenAI (default {maxTokenBounds.max.toLocaleString()} max).
              </span>
            </div>
          </label>
        </div>
      </section>

      <section className={SETTINGS_CARD_CONTAINER_CLASSES}>
        <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>OpenAI API key</h3>
        <p className={SETTINGS_SECTION_HELPER_CLASSES}>
          Keys are stored in local storage. They are only sent to the backend when you trigger a generation with the OpenAI provider selected.
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSaveKey}>
          <label className={SETTINGS_FORM_LABEL_CLASSES}>
            API key
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={hasOpenAiApiKey ? 'Key configured – enter a new key to replace it' : 'sk-...'}
              className={SETTINGS_FORM_INPUT_CLASSES}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className={SETTINGS_PRIMARY_BUTTON_CLASSES}
              disabled={apiKeyDraft.trim().length === 0}
            >
              Save API key
            </button>
            <button
              type="button"
              className={SETTINGS_SECONDARY_BUTTON_CLASSES}
              onClick={handleClearKey}
              disabled={!hasOpenAiApiKey}
            >
              Clear key
            </button>
            {hasOpenAiApiKey ? (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Key stored</span>
            ) : (
              <span className={SETTINGS_SECTION_HELPER_CLASSES}>No key stored</span>
            )}
          </div>
        </form>
        {feedback ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold shadow-sm ${
              feedback.tone === 'success'
                ? 'border-emerald-300/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-rose-300/70 bg-rose-50/70 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
            }`}
          >
            {feedback.message}
          </div>
        ) : null}
      </section>

      <section className={SETTINGS_CARD_CONTAINER_CLASSES}>
        <h3 className={SETTINGS_SECTION_TITLE_CLASSES}>OpenRouter credentials</h3>
        <p className={SETTINGS_SECTION_HELPER_CLASSES}>
          Configure access to OpenRouter before selecting the Grok 4 provider. The optional site fields let you appear in OpenRouter rankings.
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSaveOpenRouterKey}>
          <label className={SETTINGS_FORM_LABEL_CLASSES}>
            API key
            <input
              type="password"
              value={openRouterKeyDraft}
              onChange={(event) => setOpenRouterKeyDraft(event.target.value)}
              placeholder={hasOpenRouterApiKey ? 'Key configured – enter a new key to replace it' : 'or-...'}
              className={SETTINGS_FORM_INPUT_CLASSES}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className={SETTINGS_PRIMARY_BUTTON_CLASSES}
              disabled={openRouterKeyDraft.trim().length === 0}
            >
              Save API key
            </button>
            <button
              type="button"
              className={SETTINGS_SECONDARY_BUTTON_CLASSES}
              onClick={handleClearOpenRouterKey}
              disabled={!hasOpenRouterApiKey}
            >
              Clear key
            </button>
            {hasOpenRouterApiKey ? (
              <span className="text-scale-xs font-weight-semibold text-status-success">Key stored</span>
            ) : (
              <span className={SETTINGS_SECTION_HELPER_CLASSES}>No key stored</span>
            )}
          </div>
        </form>

        <div className="flex flex-col gap-3 text-scale-xs font-weight-semibold uppercase tracking-wide text-secondary">
          <div className="flex flex-col gap-2">
            <label className={SETTINGS_SECTION_LABEL_CLASSES}>HTTP referer (optional)</label>
            <input
              type="url"
              value={openRouterRefererDraft}
              onChange={(event) => setOpenRouterRefererDraft(event.target.value)}
              placeholder="https://example.com"
              className={SETTINGS_FORM_INPUT_CLASSES}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label>Site title (optional)</label>
            <input
              type="text"
              value={openRouterTitleDraft}
              onChange={(event) => setOpenRouterTitleDraft(event.target.value)}
              placeholder="My AppHub instance"
              className={SETTINGS_FORM_INPUT_CLASSES}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={SETTINGS_SECONDARY_BUTTON_CLASSES}
              onClick={handleSaveOpenRouterMetadata}
            >
              Save site info
            </button>
            <span className={SETTINGS_SECTION_HELPER_CLASSES}>
              Optional headers for OpenRouter rankings. Leave blank to omit.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
