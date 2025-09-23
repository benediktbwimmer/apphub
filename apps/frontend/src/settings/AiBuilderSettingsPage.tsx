import { useState, type FormEventHandler } from 'react';
import { useEffect, useMemo, useState, type FormEventHandler } from 'react';
import { useAiBuilderSettings } from '../ai/useAiBuilderSettings';
import type { AiBuilderProvider } from '../ai/types';

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
  }
];

type Feedback = { tone: 'success' | 'error'; message: string } | null;

export default function AiBuilderSettingsPage() {
  const {
    settings,
    hasOpenAiApiKey,
    setOpenAiApiKey,
    clearOpenAiApiKey,
    setPreferredProvider,
    setOpenAiMaxOutputTokens
  } = useAiBuilderSettings();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState(() => settings.openAiMaxOutputTokens.toString());
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    setTokenDraft(settings.openAiMaxOutputTokens.toString());
  }, [settings.openAiMaxOutputTokens]);

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
    setFeedback({ tone: 'success', message: `Preferred provider set to ${provider === 'openai' ? 'OpenAI GPT-5' : 'Codex CLI'}.` });
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">AI builder configuration</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Store your OpenAI credentials locally and choose the default provider for workflow generations. Keys never leave your browser until you trigger a generation request.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Default provider</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          The AI builder will start with this provider when you open the dialog. You can still switch providers on each run.
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {PROVIDER_OPTIONS.map((option) => {
            const active = settings.preferredProvider === option.value;
            return (
              <label
                key={option.value}
                className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  active
                    ? 'border-violet-500/70 bg-violet-500/10 text-violet-900 dark:border-violet-400/60 dark:bg-violet-400/10 dark:text-violet-100'
                    : 'border-slate-200/70 bg-white/60 text-slate-700 hover:border-slate-300 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="ai-provider"
                    value={option.value}
                    checked={active}
                    onChange={() => handleProviderChange(option.value)}
                    className="h-4 w-4 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="font-semibold">{option.label}</span>
                </span>
                <span className="pl-7 text-xs text-slate-600 dark:text-slate-400">{option.description}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            OpenAI max output tokens
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={maxTokenBounds.min}
                max={maxTokenBounds.max}
                step={maxTokenBounds.step}
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
                inputMode="numeric"
              />
              <button
                type="button"
                className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSaveTokens}
              >
                Save
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Used when generating with OpenAI (default {maxTokenBounds.max.toLocaleString()} max).
              </span>
            </div>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">OpenAI API key</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Keys are stored in local storage. They are only sent to the backend when you trigger a generation with the OpenAI provider selected.
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSaveKey}>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            API key
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={hasOpenAiApiKey ? 'Key configured – enter a new key to replace it' : 'sk-...'}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={apiKeyDraft.trim().length === 0}
            >
              Save API key
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={handleClearKey}
              disabled={!hasOpenAiApiKey}
            >
              Clear key
            </button>
            {hasOpenAiApiKey ? (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Key stored</span>
            ) : (
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">No key stored</span>
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
    </div>
  );
}
