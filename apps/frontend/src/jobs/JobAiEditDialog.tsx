import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../components';
import { useAiBuilderSettings } from '../ai/useAiBuilderSettings';
import type { AiBuilderProvider } from '../ai/types';
import { aiEditJobBundle, type BundleEditorData, type BundleAiEditInput } from './api';
import { useAuth } from '../auth/useAuth';
import {
  JOB_DIALOG_BODY_CLASSES,
  JOB_DIALOG_CLOSE_BUTTON_CLASSES,
  JOB_DIALOG_CONTAINER_BASE,
  JOB_DIALOG_HEADER_CLASSES,
  JOB_DIALOG_SUBTITLE_CLASSES,
  JOB_DIALOG_TITLE_CLASSES,
  JOB_FORM_LABEL_CLASSES,
  JOB_FORM_ACTION_PRIMARY_CLASSES,
  JOB_FORM_ACTION_SECONDARY_CLASSES,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_FORM_PROVIDER_CARD_ACTIVE,
  JOB_FORM_PROVIDER_CARD_BASE,
  JOB_FORM_PROVIDER_CARD_DISABLED,
  JOB_FORM_PROVIDER_CARD_INACTIVE,
  JOB_FORM_PROVIDER_SUBTITLE_CLASSES,
  JOB_FORM_SECTION_LABEL_CLASSES,
  JOB_FORM_TEXTAREA_CLASSES
} from './jobTokens';

type JobAiEditDialogProps = {
  open: boolean;
  onClose: () => void;
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
  job,
  bundle,
  onComplete,
  onBusyChange
}: JobAiEditDialogProps) {
  const { activeToken } = useAuth();
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
        if (!activeToken) {
          throw new Error('Authentication required to request AI edits.');
        }
        const result = await aiEditJobBundle(activeToken, job.slug, payload);
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
      job,
      prompt,
      provider,
      activeToken,
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
    <Modal
      open={open}
      onClose={close}
      labelledBy="job-ai-edit-title"
      className="items-start justify-center p-4 pt-10 sm:items-center sm:p-6"
      contentClassName={classNames('max-w-2xl', JOB_DIALOG_CONTAINER_BASE)}
    >
      <header className={JOB_DIALOG_HEADER_CLASSES}>
        <div>
          <h2 id="job-ai-edit-title" className={JOB_DIALOG_TITLE_CLASSES}>
            Edit bundle with AI
          </h2>
          <p className={JOB_DIALOG_SUBTITLE_CLASSES}>
            {job.name} · {bundle.slug}@{bundle.version}
          </p>
        </div>
        <button
          type="button"
          className={JOB_DIALOG_CLOSE_BUTTON_CLASSES}
          onClick={close}
        >
          Close
        </button>
      </header>

      <form className={JOB_DIALOG_BODY_CLASSES} onSubmit={handleSubmit}>
        <section className="flex flex-col gap-2">
          <label className={JOB_FORM_LABEL_CLASSES}>
            Describe the changes
            <textarea
              className={classNames('mt-2 h-40', JOB_FORM_TEXTAREA_CLASSES)}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Example: Update the handler to validate inputs, log job progress, and return a structured result."
              disabled={submitting}
            />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <span className={JOB_FORM_SECTION_LABEL_CLASSES}>
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
                  className={classNames(
                    JOB_FORM_PROVIDER_CARD_BASE,
                    isActive ? JOB_FORM_PROVIDER_CARD_ACTIVE : JOB_FORM_PROVIDER_CARD_INACTIVE,
                    disabled ? JOB_FORM_PROVIDER_CARD_DISABLED : null
                  )}
                  onClick={() => !disabled && handleProviderChange(choice.value)}
                  disabled={disabled}
                  title={title}
                >
                  <span className="text-sm font-semibold">{choice.label}</span>
                  <span className={JOB_FORM_PROVIDER_SUBTITLE_CLASSES}>{choice.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        {error && <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            className={JOB_FORM_ACTION_SECONDARY_CLASSES}
            onClick={close}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={JOB_FORM_ACTION_PRIMARY_CLASSES}
            disabled={submitDisabled}
          >
            {submitting ? 'Generating…' : 'Generate update'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
