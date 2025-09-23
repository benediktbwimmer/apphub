import { useContext } from 'react';
import { AiBuilderSettingsContext } from './aiBuilderSettingsContext';
import type { AiBuilderSettingsContextValue } from './aiBuilderSettingsContext';

export function useAiBuilderSettings(): AiBuilderSettingsContextValue {
  const context = useContext(AiBuilderSettingsContext);
  if (!context) {
    throw new Error('useAiBuilderSettings must be used within AiBuilderSettingsProvider');
  }
  return context;
}
