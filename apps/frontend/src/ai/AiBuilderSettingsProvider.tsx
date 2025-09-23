import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AiBuilderSettingsContext } from './aiBuilderSettingsContext';
import type {
  AiBuilderSettingsContextValue,
  AiBuilderStoredSettings
} from './aiBuilderSettingsContext';
import type { AiBuilderProvider } from './types';

type StoredSettings = AiBuilderStoredSettings;

const DEFAULT_SETTINGS: StoredSettings = {
  openAiApiKey: '',
  preferredProvider: 'codex',
  openAiMaxOutputTokens: 4096,
  openRouterApiKey: '',
  openRouterReferer: '',
  openRouterTitle: ''
};

const STORAGE_KEY = 'apphub.aiBuilderSettings.v1';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function parseStoredSettings(raw: string | null): StoredSettings {
  if (!raw) {
    return DEFAULT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    const apiKey = typeof parsed.openAiApiKey === 'string' ? parsed.openAiApiKey : '';
    const provider =
      parsed.preferredProvider === 'openai' ||
      parsed.preferredProvider === 'codex' ||
      parsed.preferredProvider === 'openrouter'
      ? parsed.preferredProvider
      : 'codex';
    const maxTokens = typeof parsed.openAiMaxOutputTokens === 'number' && Number.isFinite(parsed.openAiMaxOutputTokens)
      ? Math.min(Math.max(Math.trunc(parsed.openAiMaxOutputTokens), 256), 32_000)
      : DEFAULT_SETTINGS.openAiMaxOutputTokens;
    const openRouterApiKey = typeof parsed.openRouterApiKey === 'string' ? parsed.openRouterApiKey : '';
    const openRouterReferer = typeof parsed.openRouterReferer === 'string' ? parsed.openRouterReferer : '';
    const openRouterTitle = typeof parsed.openRouterTitle === 'string' ? parsed.openRouterTitle : '';
    return {
      openAiApiKey: apiKey,
      preferredProvider: provider,
      openAiMaxOutputTokens: maxTokens,
      openRouterApiKey,
      openRouterReferer,
      openRouterTitle
    } satisfies StoredSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadInitialSettings(): StoredSettings {
  if (!isBrowser()) {
    return DEFAULT_SETTINGS;
  }
  return parseStoredSettings(window.localStorage.getItem(STORAGE_KEY));
}

function persistSettings(settings: StoredSettings): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence errors (quota exceeded, disabled storage, etc.).
  }
}

export function AiBuilderSettingsProvider({ children }: PropsWithChildren<unknown>) {
  const initial = useRef(loadInitialSettings());
  const [settings, setSettings] = useState<StoredSettings>(() => initial.current);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  const setOpenAiApiKey = useCallback((value: string) => {
    setSettings((prev) => ({
      ...prev,
      openAiApiKey: value.trim()
    }));
  }, []);

  const clearOpenAiApiKey = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      openAiApiKey: ''
    }));
  }, []);

  const setOpenRouterApiKey = useCallback((value: string) => {
    setSettings((prev) => ({
      ...prev,
      openRouterApiKey: value.trim()
    }));
  }, []);

  const clearOpenRouterApiKey = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      openRouterApiKey: ''
    }));
  }, []);

  const setOpenRouterReferer = useCallback((value: string) => {
    setSettings((prev) => ({
      ...prev,
      openRouterReferer: value.trim()
    }));
  }, []);

  const setOpenRouterTitle = useCallback((value: string) => {
    setSettings((prev) => ({
      ...prev,
      openRouterTitle: value.trim()
    }));
  }, []);

  const setPreferredProvider = useCallback((provider: AiBuilderProvider) => {
    setSettings((prev) => ({
      ...prev,
      preferredProvider: provider
    }));
  }, []);

  const setOpenAiMaxOutputTokens = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const normalized = Math.min(Math.max(Math.trunc(value), 256), 32_000);
    setSettings((prev) => ({
      ...prev,
      openAiMaxOutputTokens: normalized
    }));
  }, []);

  const value = useMemo<AiBuilderSettingsContextValue>(() => {
    return {
      settings,
      hasOpenAiApiKey: settings.openAiApiKey.trim().length > 0,
      hasOpenRouterApiKey: settings.openRouterApiKey.trim().length > 0,
      setOpenAiApiKey,
      clearOpenAiApiKey,
      setPreferredProvider,
      setOpenAiMaxOutputTokens,
      setOpenRouterApiKey,
      clearOpenRouterApiKey,
      setOpenRouterReferer,
      setOpenRouterTitle
    } satisfies AiBuilderSettingsContextValue;
  }, [
    settings,
    setOpenAiApiKey,
    clearOpenAiApiKey,
    setPreferredProvider,
    setOpenAiMaxOutputTokens,
    setOpenRouterApiKey,
    clearOpenRouterApiKey,
    setOpenRouterReferer,
    setOpenRouterTitle
  ]);

  return <AiBuilderSettingsContext.Provider value={value}>{children}</AiBuilderSettingsContext.Provider>;
}
