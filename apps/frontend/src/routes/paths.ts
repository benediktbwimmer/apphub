export const ROUTE_SEGMENTS = {
  catalog: 'catalog',
  apps: 'services',
  runs: 'runs',
  jobs: 'jobs',
  workflows: 'workflows',
  import: 'import',
  settings: 'settings',
  settingsPreview: 'preview',
  settingsApiAccess: 'api',
  settingsAiBuilder: 'ai-builder'
} as const;

export const ROUTE_PATHS = {
  catalog: `/${ROUTE_SEGMENTS.catalog}`,
  apps: `/${ROUTE_SEGMENTS.apps}`,
  runs: `/${ROUTE_SEGMENTS.runs}`,
  jobs: `/${ROUTE_SEGMENTS.jobs}`,
  workflows: `/${ROUTE_SEGMENTS.workflows}`,
  import: `/${ROUTE_SEGMENTS.import}`,
  settings: `/${ROUTE_SEGMENTS.settings}`,
  settingsPreview: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsPreview}`,
  settingsApiAccess: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsApiAccess}`,
  settingsAiBuilder: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAiBuilder}`
} as const;

export type PrimaryNavKey = 'catalog' | 'apps' | 'runs' | 'jobs' | 'workflows' | 'import' | 'settings';

export type PrimaryNavigationItem = {
  key: PrimaryNavKey;
  label: string;
  path: string;
};

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavigationItem[] = [
  { key: 'catalog', label: 'Catalog', path: ROUTE_PATHS.catalog },
  { key: 'apps', label: 'Apps', path: ROUTE_PATHS.apps },
  { key: 'runs', label: 'Runs', path: ROUTE_PATHS.runs },
  { key: 'jobs', label: 'Jobs', path: ROUTE_PATHS.jobs },
  { key: 'workflows', label: 'Workflows', path: ROUTE_PATHS.workflows },
  { key: 'import', label: 'Import', path: ROUTE_PATHS.import },
  { key: 'settings', label: 'Settings', path: ROUTE_PATHS.settings }
] as const;

export const LEGACY_IMPORT_PATHS = ['/submit', '/import-manifest'] as const;
