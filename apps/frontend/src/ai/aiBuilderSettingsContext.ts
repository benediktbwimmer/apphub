import { createContext } from 'react';
import type { AiBuilderProvider } from './types';

export type AiBuilderStoredSettings = {
  openAiApiKey: string;
  preferredProvider: AiBuilderProvider;
  openAiMaxOutputTokens: number;
  openRouterApiKey: string;
  openRouterReferer: string;
  openRouterTitle: string;
};

export type AiBuilderSettingsContextValue = {
  settings: AiBuilderStoredSettings;
  hasOpenAiApiKey: boolean;
  hasOpenRouterApiKey: boolean;
  setOpenAiApiKey: (value: string) => void;
  clearOpenAiApiKey: () => void;
  setPreferredProvider: (provider: AiBuilderProvider) => void;
  setOpenAiMaxOutputTokens: (value: number) => void;
  setOpenRouterApiKey: (value: string) => void;
  clearOpenRouterApiKey: () => void;
  setOpenRouterReferer: (value: string) => void;
  setOpenRouterTitle: (value: string) => void;
};

export const AiBuilderSettingsContext = createContext<AiBuilderSettingsContextValue | undefined>(undefined);
