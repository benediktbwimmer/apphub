export const ROUTE_SEGMENTS = {
  overview: 'overview',
  catalog: 'catalog',
  events: 'events',
  assets: 'assets',
  services: 'services',
  servicesOverview: 'overview',
  servicesTimestore: 'timestore',
  servicesTimestoreDatasets: 'datasets',
  servicesTimestoreSql: 'sql',
  servicesFilestore: 'filestore',
  servicesMetastore: 'metastore',
  observatory: 'observatory',
  runs: 'runs',
  jobs: 'jobs',
  workflows: 'workflows',
  topology: 'topology',
  schedules: 'schedules',
  import: 'import',
  settings: 'settings',
  settingsPreview: 'preview',
  settingsApiAccess: 'api',
  settingsAiBuilder: 'ai-builder',
  settingsRuntimeScaling: 'runtime-scaling',
  settingsAdmin: 'admin',
  settingsImport: 'import'
} as const;

export const ROUTE_PATHS = {
  overview: `/${ROUTE_SEGMENTS.overview}`,
  catalog: `/${ROUTE_SEGMENTS.catalog}`,
  events: `/${ROUTE_SEGMENTS.events}`,
  assets: `/${ROUTE_SEGMENTS.assets}`,
  services: `/${ROUTE_SEGMENTS.services}`,
  servicesOverview: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesOverview}`,
  servicesTimestore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}`,
  servicesTimestoreDatasets: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}/${ROUTE_SEGMENTS.servicesTimestoreDatasets}`,
  servicesTimestoreSql: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}/${ROUTE_SEGMENTS.servicesTimestoreSql}`,
  servicesFilestore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesFilestore}`,
  servicesMetastore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesMetastore}`,
  observatory: `/${ROUTE_SEGMENTS.observatory}`,
  runs: `/${ROUTE_SEGMENTS.runs}`,
  jobs: `/${ROUTE_SEGMENTS.jobs}`,
  workflows: `/${ROUTE_SEGMENTS.workflows}`,
  topology: `/${ROUTE_SEGMENTS.topology}`,
  schedules: `/${ROUTE_SEGMENTS.schedules}`,
  import: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsImport}`,
  settings: `/${ROUTE_SEGMENTS.settings}`,
  settingsPreview: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsPreview}`,
  settingsApiAccess: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsApiAccess}`,
  settingsRuntimeScaling: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsRuntimeScaling}`,
  settingsAiBuilder: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAiBuilder}`,
  settingsAdmin: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAdmin}`,
  settingsImport: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsImport}`
} as const;

export type PrimaryNavKey =
  | 'overview'
  | 'catalog'
  | 'events'
  | 'assets'
  | 'services'
  | 'observatory'
  | 'runs'
  | 'jobs'
  | 'workflows'
  | 'topology'
  | 'schedules'
  | 'settings';

export type PrimaryNavigationItem = {
  key: PrimaryNavKey;
  label: string;
  path: string;
};

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavigationItem[] = [
  { key: 'overview', label: 'Overview', path: ROUTE_PATHS.overview },
  { key: 'catalog', label: 'Apps', path: ROUTE_PATHS.catalog },
  { key: 'events', label: 'Events', path: ROUTE_PATHS.events },
  { key: 'assets', label: 'Assets', path: ROUTE_PATHS.assets },
  { key: 'services', label: 'Services', path: ROUTE_PATHS.services },
  { key: 'observatory', label: 'Observatory', path: ROUTE_PATHS.observatory },
  { key: 'runs', label: 'Runs', path: ROUTE_PATHS.runs },
  { key: 'jobs', label: 'Jobs', path: ROUTE_PATHS.jobs },
  { key: 'workflows', label: 'Workflows', path: ROUTE_PATHS.workflows },
  { key: 'topology', label: 'Topology', path: ROUTE_PATHS.topology },
  { key: 'schedules', label: 'Schedules', path: ROUTE_PATHS.schedules },
  { key: 'settings', label: 'Settings', path: ROUTE_PATHS.settings }
] as const;

export const LEGACY_IMPORT_PATHS = ['/submit', '/import-manifest'] as const;
