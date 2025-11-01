import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAppHubEvent, type AppHubSocketEvent } from '../events/context';
import { ModuleScopeContextProvider, type ModuleScopeContextValue } from './ModuleScopeContext';
import type { ModuleResourceContext, ModuleResourceType, ModuleSummary } from './types';
import { fetchModuleResources, fetchModules } from './api';

type ModuleScopeProviderProps = {
  children: React.ReactNode;
};

function normalizeSubPath(input: string): string {
  if (!input || input === '/') {
    return '/';
  }
  return input.startsWith('/') ? input : `/${input}`;
}

function stripPrefix(pathname: string, prefix: string): string {
  if (!prefix) {
    return pathname || '/';
  }
  if (pathname === prefix) {
    return '/';
  }
  if (pathname.startsWith(`${prefix}/`)) {
    const stripped = pathname.slice(prefix.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
  return pathname || '/';
}

export function ModuleScopeProvider({ children }: ModuleScopeProviderProps) {
  const { moduleId: routeModuleId } = useParams<{ moduleId?: string }>();
  const moduleId = routeModuleId ? decodeURIComponent(routeModuleId) : null;
  const location = useLocation();
  const navigate = useNavigate();
  const authorizedFetch = useAuthorizedFetch();

  const modulePathPrefix = moduleId ? `/modules/${encodeURIComponent(moduleId)}` : '';
  const relativePath = useMemo(() => stripPrefix(location.pathname, modulePathPrefix), [
    location.pathname,
    modulePathPrefix
  ]);

  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [loadingModules, setLoadingModules] = useState(false);

  const [resources, setResources] = useState<ModuleResourceContext[] | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [loadingResources, setLoadingResources] = useState(false);

  // Load module catalog once the user is authenticated
  useEffect(() => {
    if (!authorizedFetch.authToken) {
      setModules([]);
      setModulesError(null);
      return;
    }
    const controller = new AbortController();
    setLoadingModules(true);
    setModulesError(null);
    fetchModules(authorizedFetch, { signal: controller.signal })
      .then((list) => {
        setModules(list);
        setModulesError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setModulesError(error instanceof Error ? error.message : 'Failed to load modules');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingModules(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch]);

  // Load module resources when moduleId changes
  useEffect(() => {
    if (!moduleId) {
      setResources(null);
      setResourcesError(null);
      setLoadingResources(false);
      return;
    }

    if (!authorizedFetch.authToken) {
      setResources(null);
      setResourcesError('Authentication required');
      setLoadingResources(false);
      return;
    }

    const controller = new AbortController();
    setLoadingResources(true);
    setResourcesError(null);

    fetchModuleResources(authorizedFetch, moduleId, { signal: controller.signal })
      .then((payload) => {
        setResources(payload.resources);
        setResourcesError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setResourcesError(error instanceof Error ? error.message : 'Failed to load module resources');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingResources(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authorizedFetch, moduleId]);

  const moduleVersion = useMemo(() => {
    if (!moduleId || !resources || resources.length === 0) {
      return null;
    }
    const versions = resources
      .map((context) => context.moduleVersion)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (versions.length === 0) {
      return null;
    }
    // Use the most recent occurrence
    return versions[0];
  }, [moduleId, resources]);

  type ModuleContextEvent = Extract<AppHubSocketEvent, { type: 'module.context.updated' | 'module.context.deleted' }>;

  const resourceIndex = useMemo(() => {
    const contextsByType = new Map<ModuleResourceType, ModuleResourceContext[]>();
    const idsByType = new Map<ModuleResourceType, Set<string>>();
    const slugsByType = new Map<ModuleResourceType, Set<string>>();

    if (resources) {
      for (const context of resources) {
        const type = context.resourceType;

        let contextList = contextsByType.get(type);
        if (!contextList) {
          contextList = [];
          contextsByType.set(type, contextList);
        }
        contextList.push(context);

        let idSet = idsByType.get(type);
        if (!idSet) {
          idSet = new Set<string>();
          idsByType.set(type, idSet);
        }
        idSet.add(context.resourceId);

        if (context.resourceSlug) {
          let slugSet = slugsByType.get(type);
          if (!slugSet) {
            slugSet = new Set<string>();
            slugsByType.set(type, slugSet);
          }
          slugSet.add(context.resourceSlug);
        }
      }
    }

    return { contextsByType, idsByType, slugsByType };
  }, [resources]);

  const buildModulePath = useCallback<ModuleScopeContextValue['buildModulePath']>(
    (path, options) => {
      const hasOverride = options ? Object.prototype.hasOwnProperty.call(options, 'moduleId') : false;
      const targetModuleId = hasOverride ? options?.moduleId ?? null : moduleId;
      const normalizedPath = normalizeSubPath(path);
      if (targetModuleId) {
        if (normalizedPath === '/') {
          return `/modules/${encodeURIComponent(targetModuleId)}`;
        }
        return `/modules/${encodeURIComponent(targetModuleId)}${normalizedPath}`;
      }
      return normalizedPath;
    },
    [moduleId]
  );

  const stripModulePrefix = useCallback<ModuleScopeContextValue['stripModulePrefix']>(
    (pathname) => {
      if (!pathname) {
        return '/';
      }
      const match = pathname.match(/^\/modules\/([^/]+)(\/.*)?$/);
      if (!match) {
        return pathname || '/';
      }
      const remainder = match[2] ?? '';
      return remainder ? remainder : '/';
    },
    []
  );

  const setModuleId = useCallback<ModuleScopeContextValue['setModuleId']>(
    (nextModuleId, options) => {
      const preservePath = options?.preservePath ?? true;
      const replace = options?.replace ?? false;
      const currentSubPath = preservePath ? normalizeSubPath(relativePath) : '/';
      const targetPath = buildModulePath(currentSubPath, { moduleId: nextModuleId });
      if (targetPath === location.pathname) {
        return;
      }
      navigate(`${targetPath}${location.search}${location.hash}`, { replace });
    },
    [buildModulePath, location.hash, location.pathname, location.search, navigate, relativePath]
  );

  const getResourceContexts = useCallback<ModuleScopeContextValue['getResourceContexts']>(
    (resourceType) => {
      const list = resourceIndex.contextsByType.get(resourceType);
      return list ? list.slice() : [];
    },
    [resourceIndex]
  );

  const getResourceIds = useCallback<ModuleScopeContextValue['getResourceIds']>(
    (resourceType) => {
      const set = resourceIndex.idsByType.get(resourceType);
      return set ? Array.from(set) : [];
    },
    [resourceIndex]
  );

  const getResourceSlugs = useCallback<ModuleScopeContextValue['getResourceSlugs']>(
    (resourceType) => {
      const set = resourceIndex.slugsByType.get(resourceType);
      return set ? Array.from(set) : [];
    },
    [resourceIndex]
  );

  const isResourceInScope = useCallback<ModuleScopeContextValue['isResourceInScope']>(
    (resourceType, identifier) => {
      if (!identifier) {
        return false;
      }
      const normalized = identifier.trim();
      if (!normalized) {
        return false;
      }
      const idSet = resourceIndex.idsByType.get(resourceType);
      if (idSet?.has(normalized)) {
        return true;
      }
      const slugSet = resourceIndex.slugsByType.get(resourceType);
      if (slugSet?.has(normalized)) {
        return true;
      }
      return false;
    },
    [resourceIndex]
  );

  const handleModuleContextEvent = useCallback(
    (event: ModuleContextEvent) => {
      if (!moduleId) {
        return;
      }
      const context = event.data.context;
      if (context.moduleId !== moduleId) {
        return;
      }
      setResources((prev) => {
        if (!prev) {
          return prev;
        }
        if (event.type === 'module.context.deleted') {
          return prev.filter((entry) => entry.resourceId !== context.resourceId || entry.resourceType !== context.resourceType);
        }
        const next = prev.filter((entry) => entry.resourceId !== context.resourceId || entry.resourceType !== context.resourceType);
        next.unshift(context);
        return next;
      });
    },
    [moduleId]
  );

  useAppHubEvent(['module.context.updated', 'module.context.deleted'], handleModuleContextEvent);

  const contextValue = useMemo<ModuleScopeContextValue>(() => ({
    kind: moduleId ? 'module' : 'all',
    moduleId,
    moduleVersion,
    modules,
    loadingModules,
    modulesError,
    resources,
    loadingResources,
    resourcesError,
    setModuleId,
    buildModulePath,
    stripModulePrefix,
    getResourceContexts,
    getResourceIds,
    getResourceSlugs,
    isResourceInScope
  }), [
    moduleId,
    moduleVersion,
    modules,
    loadingModules,
    modulesError,
    resources,
    loadingResources,
    resourcesError,
    setModuleId,
    buildModulePath,
    stripModulePrefix,
    getResourceContexts,
    getResourceIds,
    getResourceSlugs,
    isResourceInScope
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const globalState = window as unknown as Record<string, string | null>;
    globalState.__APPHUB_ACTIVE_MODULE_ID = moduleId ?? null;
    return () => {
      globalState.__APPHUB_ACTIVE_MODULE_ID = null;
    };
  }, [moduleId]);

  return <ModuleScopeContextProvider value={contextValue}>{children}</ModuleScopeContextProvider>;
}
