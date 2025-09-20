import { createContext, useContext } from 'react';

export type ActiveTab = 'catalog' | 'apps' | 'submit' | 'import-manifest';

export interface NavigationContextValue {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation() {
  const context = useContext(NavigationContext);

  if (!context) {
    throw new Error('useNavigation must be used within a NavigationContext provider');
  }

  return context;
}
