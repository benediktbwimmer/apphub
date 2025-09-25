export const ROUTE_SEGMENTS = {
  overview: 'overview',
  catalog: 'catalog',
  assets: 'assets',
  services: 'services',
  runs: 'runs',
  jobs: 'jobs',
  workflows: 'workflows',
  import: 'import',
  settings: 'settings',
  settingsPreview: 'preview',
  settingsApiAccess: 'api',
  settingsAiBuilder: 'ai-builder',
  settingsAdmin: 'admin'
} as const;

export const ROUTE_PATHS = {
  overview: `/${ROUTE_SEGMENTS.overview}`,
  catalog: `/${ROUTE_SEGMENTS.catalog}`,
  assets: `/${ROUTE_SEGMENTS.assets}`,
  services: `/${ROUTE_SEGMENTS.services}`,
  runs: `/${ROUTE_SEGMENTS.runs}`,
  jobs: `/${ROUTE_SEGMENTS.jobs}`,
  workflows: `/${ROUTE_SEGMENTS.workflows}`,
  import: `/${ROUTE_SEGMENTS.import}`,
  settings: `/${ROUTE_SEGMENTS.settings}`,
  settingsPreview: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsPreview}`,
  settingsApiAccess: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsApiAccess}`,
  settingsAiBuilder: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAiBuilder}`,
  settingsAdmin: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAdmin}`
} as const;

export type PrimaryNavKey =
  | 'overview'
  | 'catalog'
  | 'assets'
  | 'services'
  | 'runs'
  | 'jobs'
  | 'workflows'
  | 'import'
  | 'settings';

export type PrimaryNavigationItem = {
  key: PrimaryNavKey;
  label: string;
  path: string;
};

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavigationItem[] = [
  { key: 'overview', label: 'Overview', path: ROUTE_PATHS.overview },
  { key: 'catalog', label: 'Apps', path: ROUTE_PATHS.catalog },
  { key: 'assets', label: 'Assets', path: ROUTE_PATHS.assets },
  { key: 'services', label: 'Services', path: ROUTE_PATHS.services },
  { key: 'runs', label: 'Runs', path: ROUTE_PATHS.runs },
  { key: 'jobs', label: 'Jobs', path: ROUTE_PATHS.jobs },
  { key: 'workflows', label: 'Workflows', path: ROUTE_PATHS.workflows },
  { key: 'import', label: 'Import', path: ROUTE_PATHS.import },
  { key: 'settings', label: 'Settings', path: ROUTE_PATHS.settings }
] as const;

export const LEGACY_IMPORT_PATHS = ['/submit', '/import-manifest'] as const;
