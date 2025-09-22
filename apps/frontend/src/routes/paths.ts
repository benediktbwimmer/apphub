export const ROUTE_SEGMENTS = {
  catalog: 'catalog',
  apps: 'services',
  workflows: 'workflows',
  import: 'import',
  apiAccess: 'api'
} as const;

export const ROUTE_PATHS = {
  catalog: `/${ROUTE_SEGMENTS.catalog}`,
  apps: `/${ROUTE_SEGMENTS.apps}`,
  workflows: `/${ROUTE_SEGMENTS.workflows}`,
  import: `/${ROUTE_SEGMENTS.import}`,
  apiAccess: `/${ROUTE_SEGMENTS.apiAccess}`
} as const;

export type PrimaryNavKey = 'catalog' | 'apps' | 'workflows' | 'import' | 'api-access';

export type PrimaryNavigationItem = {
  key: PrimaryNavKey;
  label: string;
  path: string;
};

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavigationItem[] = [
  { key: 'catalog', label: 'Catalog', path: ROUTE_PATHS.catalog },
  { key: 'apps', label: 'Apps', path: ROUTE_PATHS.apps },
  { key: 'workflows', label: 'Workflows', path: ROUTE_PATHS.workflows },
  { key: 'import', label: 'Import', path: ROUTE_PATHS.import },
  { key: 'api-access', label: 'API Access', path: ROUTE_PATHS.apiAccess }
] as const;

export const LEGACY_IMPORT_PATHS = ['/submit', '/import-manifest'] as const;
