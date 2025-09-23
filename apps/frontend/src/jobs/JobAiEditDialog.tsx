import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthorizedFetch } from '../workflows/api';
import { useAiBuilderSettings } from '../ai/useAiBuilderSettings';
import type { AiBuilderProvider } from '../ai/types';
import { aiEditJobBundle, type BundleEditorData, type BundleAiEditInput } from './api';

type JobAiEditDialogProps = {
  open: boolean;
  onClose: () => void;
  authorizedFetch: AuthorizedFetch;
  job: {
    slug: string;
    name: string;
    runtime: string | null;
  } | null;
  bundle: {
    slug: string;
    version: string;
    entryPoint: string;
  } | null;
  onComplete: (data: BundleEditorData) => void;
  onBusyChange?: (busy: boolean) => void;
};

const PROVIDER_CHOICES: Array<{
  value: 'openai' | 'openrouter';
  label: string;
  description: string;
  requiresKey: AiBuilderProvider;
}> = [
  {
    value: 'openai',
    label: 'OpenAI GPT-5',
    description: 'High reasoning depth with structured JSON responses. Requires an OpenAI API key.',
    requiresKey: 'openai'
  },
  {
    value: 'openrouter',
    label: 'Grok 4 (OpenRouter)',
    description: "xAI's Grok model via OpenRouter. Requires an OpenRouter API key.",
    requiresKey: 'openrouter'
  }
];

function providerNeedsKey(provider: 'openai' | 'openrouter', hasOpenAiKey: boolean, hasOpenRouterKey: boolean): boolean {
  if (provider === 'openai') {
    return !hasOpenAiKey;
  }
  return !hasOpenRouterKey;
}

function pickInitialProvider(preferred: AiBuilderProvider, hasOpenAiKey: boolean, hasOpenRouterKey: boolean): 'openai' | 'openrouter' {
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
  return preferred === 'openrouter' ? 'openrouter' : 'openai';
}

export default function JobAiEditDialog({
  open,
  onClose,
  authorizedFetch,
  job,
  bundle,
  onComplete,
  onBusyChange
}: JobAiEditDialogProps) {
  const aiSettings = useAiBuilderSettings();
  const hasOpenAiKey = aiSettings.hasOpenAiApiKey;
  const hasOpenRouterKey = aiSettings.hasOpenRouterApiKey;

  const initialProvider = useMemo(
    () => pickInitialProvider(aiSettings.settings.preferredProvider, hasOpenAiKey, hasOpenRouterKey),
    [aiSettings.settings.preferredProvider, hasOpenAiKey, hasOpenRouterKey]
  );

  const [provider, setProvider] = useState<'openai' | 'openrouter'>(initialProvider);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPrompt('');
    setError(null);
    setProvider(pickInitialProvider(aiSettings.settings.preferredProvider, hasOpenAiKey, hasOpenRouterKey));
  }, [open, aiSettings.settings.preferredProvider, hasOpenAiKey, hasOpenRouterKey]);

  const close = useCallback(() => {
    if (submitting) {
      return;
    }
    onClose();
  }, [onClose, submitting]);

  const busyGuard = useCallback(
    (value: boolean) => {
      onBusyChange?.(value);
      setSubmitting(value);
    },
    [onBusyChange]
  );

  const handleProviderChange = useCallback(
    (next: 'openai' | 'openrouter') => {
      setProvider(next);
      const normalized: AiBuilderProvider = next;
      aiSettings.setPreferredProvider(normalized);
    },
    [aiSettings]
  );

  const handleSubmit = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      if (!job) {
        return;
      }
      if (!prompt.trim()) {
        setError('Describe the desired changes before generating.');
        return;
      }

      const needsKey = providerNeedsKey(provider, hasOpenAiKey, hasOpenRouterKey);
      if (needsKey) {
        setError(
          provider === 'openai'
            ? 'Add an OpenAI API key in AI builder settings to use GPT-5.'
            : 'Add an OpenRouter API key in AI builder settings to call Grok.'
        );
        return;
      }

      const providerOptions: BundleAiEditInput['providerOptions'] = {};
      if (provider === 'openai') {
        providerOptions.openAiApiKey = aiSettings.settings.openAiApiKey;
        providerOptions.openAiMaxOutputTokens = aiSettings.settings.openAiMaxOutputTokens;
      } else {
        providerOptions.openRouterApiKey = aiSettings.settings.openRouterApiKey;
        const referer = aiSettings.settings.openRouterReferer?.trim();
        if (referer && referer.length > 0) {
          providerOptions.openRouterReferer = referer;
        } else if (typeof window !== 'undefined' && window.location?.origin) {
          providerOptions.openRouterReferer = window.location.origin;
        }
        const title = aiSettings.settings.openRouterTitle?.trim();
        if (title && title.length > 0) {
          providerOptions.openRouterTitle = title;
        } else if (typeof document !== 'undefined' && document.title) {
          providerOptions.openRouterTitle = document.title;
        }
      }

      const payload: BundleAiEditInput = {
        prompt: prompt.trim(),
        provider,
        providerOptions
      };

      setError(null);
      busyGuard(true);
      try {
        const result = await aiEditJobBundle(authorizedFetch, job.slug, payload);
        onComplete(result);
        setPrompt('');
        close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to edit bundle with AI';
        setError(message);
      } finally {
        busyGuard(false);
      }
    },
    [
      authorizedFetch,
      job,
      prompt,
      provider,
      aiSettings.settings.openAiApiKey,
      aiSettings.settings.openAiMaxOutputTokens,
      aiSettings.settings.openRouterApiKey,
      aiSettings.settings.openRouterReferer,
      aiSettings.settings.openRouterTitle,
      hasOpenAiKey,
      hasOpenRouterKey,
      onComplete,
      close,
      busyGuard
    ]
  );

  if (!open || !job || !bundle) {
    return null;
  }

  const providerDisabled = (value: 'openai' | 'openrouter') =>
    providerNeedsKey(value, hasOpenAiKey, hasOpenRouterKey);

  const submitDisabled = submitting || providerNeedsKey(provider, hasOpenAiKey, hasOpenRouterKey) || !prompt.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-10 backdrop-blur-sm overscroll-contain sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-ai-edit-title"
      onClick={close}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div>
            <h2 id="job-ai-edit-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Edit bundle with AI
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {job.name} · {bundle.slug}@{bundle.version}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={close}
          >
            Close
          </button>
        </header>

        <form className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" onSubmit={handleSubmit}>
          <section className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Describe the changes
              <textarea
                className="mt-2 h-40 rounded-2xl border border-slate-300 bg-white/90 px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Example: Update the handler to validate inputs, log job progress, and return a structured result."
                disabled={submitting}
              />
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Model provider
            </span>
            <div className="flex flex-col gap-2">
              {PROVIDER_CHOICES.map((choice) => {
                const isActive = provider === choice.value;
                const disabled = providerDisabled(choice.value);
                const title = disabled
                  ? choice.requiresKey === 'openai'
                    ? 'Add an OpenAI API key in AI builder settings to use GPT-5.'
                    : 'Add an OpenRouter API key in AI builder settings to call Grok.'
                  : undefined;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    className={`flex flex-col rounded-2xl border px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'border-violet-500 bg-violet-600/10 text-violet-900 dark:border-violet-400 dark:bg-violet-500/10 dark:text-violet-100'
                        : 'border-slate-300 text-slate-700 hover:border-violet-400 hover:bg-violet-500/5 dark:border-slate-600 dark:text-slate-200 dark:hover:border-violet-300'
                    } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                    onClick={() => !disabled && handleProviderChange(choice.value)}
                    disabled={disabled}
                    title={title}
                  >
                    <span className="text-sm font-semibold">{choice.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{choice.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={close}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitDisabled}
            >
              {submitting ? 'Generating…' : 'Generate update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
