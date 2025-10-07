import { createContext, useContext } from 'react';
import type { ModuleResourceContext, ModuleResourceType, ModuleSummary } from './types';

export type ModuleScopeKind = 'all' | 'module';

export type ModuleScopeContextValue = {
  kind: ModuleScopeKind;
  moduleId: string | null;
  moduleVersion: string | null;
  modules: ModuleSummary[];
  loadingModules: boolean;
  modulesError: string | null;
  resources: ModuleResourceContext[] | null;
  loadingResources: boolean;
  resourcesError: string | null;
  setModuleId: (moduleId: string | null, options?: { replace?: boolean; preservePath?: boolean }) => void;
  buildModulePath: (path: string, options?: { moduleId?: string | null }) => string;
  stripModulePrefix: (pathname: string) => string;
  getResourceContexts: (resourceType: ModuleResourceType) => ModuleResourceContext[];
  getResourceIds: (resourceType: ModuleResourceType) => string[];
  getResourceSlugs: (resourceType: ModuleResourceType) => string[];
  isResourceInScope: (resourceType: ModuleResourceType, identifier: string) => boolean;
};

const ModuleScopeContext = createContext<ModuleScopeContextValue | null>(null);

export function ModuleScopeContextProvider({
  value,
  children
}: {
  value: ModuleScopeContextValue;
  children: React.ReactNode;
}) {
  return <ModuleScopeContext.Provider value={value}>{children}</ModuleScopeContext.Provider>;
}

export function useModuleScope(): ModuleScopeContextValue {
  const context = useContext(ModuleScopeContext);
  if (!context) {
    throw new Error('useModuleScope must be used within ModuleScopeProvider');
  }
  return context;
}
