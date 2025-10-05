export const ROUTE_SEGMENTS = {
  overview: 'overview',
  observability: 'observability',
  core: 'core',
  events: 'events',
  assets: 'assets',
  services: 'services',
  servicesOverview: 'overview',
  servicesTimestore: 'timestore',
  servicesTimestoreDatasets: 'datasets',
  servicesTimestoreSql: 'sql',
  servicesFilestore: 'filestore',
  servicesMetastore: 'metastore',
  runs: 'runs',
  jobs: 'jobs',
  workflows: 'workflows',
  topology: 'topology',
  schedules: 'schedules',
  import: 'import',
  settings: 'settings',
  settingsAppearance: 'appearance',
  settingsPreview: 'preview',
  settingsApiAccess: 'api',
  settingsAiBuilder: 'ai-builder',
  settingsRuntimeScaling: 'runtime-scaling',
  settingsAdmin: 'admin',
  settingsImport: 'import'
} as const;

export const ROUTE_PATHS = {
  overview: `/${ROUTE_SEGMENTS.overview}`,
  observability: `/${ROUTE_SEGMENTS.observability}`,
  core: `/${ROUTE_SEGMENTS.core}`,
  events: `/${ROUTE_SEGMENTS.events}`,
  assets: `/${ROUTE_SEGMENTS.assets}`,
  services: `/${ROUTE_SEGMENTS.services}`,
  servicesOverview: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesOverview}`,
  servicesTimestore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}`,
  servicesTimestoreDatasets: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}/${ROUTE_SEGMENTS.servicesTimestoreDatasets}`,
  servicesTimestoreSql: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesTimestore}/${ROUTE_SEGMENTS.servicesTimestoreSql}`,
  servicesFilestore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesFilestore}`,
  servicesMetastore: `/${ROUTE_SEGMENTS.services}/${ROUTE_SEGMENTS.servicesMetastore}`,
  runs: `/${ROUTE_SEGMENTS.runs}`,
  jobs: `/${ROUTE_SEGMENTS.jobs}`,
  workflows: `/${ROUTE_SEGMENTS.workflows}`,
  topology: `/${ROUTE_SEGMENTS.topology}`,
  schedules: `/${ROUTE_SEGMENTS.schedules}`,
  import: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsImport}`,
  settings: `/${ROUTE_SEGMENTS.settings}`,
  settingsAppearance: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAppearance}`,
  settingsPreview: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsPreview}`,
  settingsApiAccess: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsApiAccess}`,
  settingsRuntimeScaling: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsRuntimeScaling}`,
  settingsAiBuilder: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAiBuilder}`,
  settingsAdmin: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsAdmin}`,
  settingsImport: `/${ROUTE_SEGMENTS.settings}/${ROUTE_SEGMENTS.settingsImport}`
} as const;

export type PrimaryNavKey =
  | 'overview'
  | 'observability'
  | 'core'
  | 'events'
  | 'assets'
  | 'services'
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
  { key: 'runs', label: 'Runs', path: ROUTE_PATHS.runs },
  { key: 'events', label: 'Events', path: ROUTE_PATHS.events },
  { key: 'services', label: 'Services', path: ROUTE_PATHS.services },
  { key: 'topology', label: 'Topology', path: ROUTE_PATHS.topology },
  { key: 'workflows', label: 'Workflows', path: ROUTE_PATHS.workflows },
  { key: 'jobs', label: 'Jobs', path: ROUTE_PATHS.jobs },
  { key: 'schedules', label: 'Schedules', path: ROUTE_PATHS.schedules },
  { key: 'assets', label: 'Assets', path: ROUTE_PATHS.assets },
  { key: 'observability', label: 'Observability', path: ROUTE_PATHS.observability },
  { key: 'core', label: 'Builds', path: ROUTE_PATHS.core },
  { key: 'settings', label: 'Settings', path: ROUTE_PATHS.settings }
] as const;

export const LEGACY_IMPORT_PATHS = ['/submit', '/import-manifest'] as const;
