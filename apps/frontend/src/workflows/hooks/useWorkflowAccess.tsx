import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useAuth } from '../../auth/useAuth';
import { useToasts } from '../../components/toast';
import type { AuthorizedFetch } from '../api';
import type { AuthContextValue } from '../../auth/context';

export type WorkflowAccessContextValue = {
  authorizedFetch: AuthorizedFetch;
  pushToast: ReturnType<typeof useToasts>['pushToast'];
  identity: AuthContextValue['identity'];
  identityScopes: Set<string>;
  isAuthenticated: boolean;
  canRunWorkflowsScope: boolean;
  canEditWorkflows: boolean;
  canUseAiBuilder: boolean;
  canCreateAiJobs: boolean;
};

const WorkflowAccessContext = createContext<WorkflowAccessContextValue | undefined>(undefined);

export function WorkflowAccessProvider({ children }: { children: ReactNode }) {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const { identity } = useAuth();

  const identityScopes = useMemo(() => new Set(identity?.scopes ?? []), [identity]);
  const isAuthenticated = Boolean(identity);

  const canRunWorkflowsScope = useMemo(() => identityScopes.has('workflows:run'), [identityScopes]);
  const canEditWorkflows = useMemo(() => identityScopes.has('workflows:write'), [identityScopes]);
  const canUseAiBuilder = useMemo(
    () => identityScopes.has('workflows:write') || identityScopes.has('jobs:write'),
    [identityScopes]
  );
  const canCreateAiJobs = useMemo(
    () => identityScopes.has('jobs:write') && identityScopes.has('job-bundles:write'),
    [identityScopes]
  );

  const value = useMemo<WorkflowAccessContextValue>(
    () => ({
      authorizedFetch,
      pushToast,
      identity,
      identityScopes,
      isAuthenticated,
      canRunWorkflowsScope,
      canEditWorkflows,
      canUseAiBuilder,
      canCreateAiJobs
    }),
    [
      authorizedFetch,
      pushToast,
      identity,
      identityScopes,
      isAuthenticated,
      canRunWorkflowsScope,
      canEditWorkflows,
      canUseAiBuilder,
      canCreateAiJobs
    ]
  );

  return <WorkflowAccessContext.Provider value={value}>{children}</WorkflowAccessContext.Provider>;
}

export function useWorkflowAccess() {
  const context = useContext(WorkflowAccessContext);
  if (!context) {
    throw new Error('useWorkflowAccess must be used within a WorkflowAccessProvider');
  }
  return context;
}
