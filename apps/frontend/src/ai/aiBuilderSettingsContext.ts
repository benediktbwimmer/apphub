import { createContext } from 'react';
import type { AiBuilderProvider } from './types';

export type AiBuilderStoredSettings = {
  openAiApiKey: string;
  preferredProvider: AiBuilderProvider;
  openAiMaxOutputTokens: number;
};

export type AiBuilderSettingsContextValue = {
  settings: AiBuilderStoredSettings;
  hasOpenAiApiKey: boolean;
  setOpenAiApiKey: (value: string) => void;
  clearOpenAiApiKey: () => void;
  setPreferredProvider: (provider: AiBuilderProvider) => void;
  setOpenAiMaxOutputTokens: (value: number) => void;
};

export const AiBuilderSettingsContext = createContext<AiBuilderSettingsContextValue | undefined>(undefined);
