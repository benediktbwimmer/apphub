export type ModuleCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  workspacePath: string;
  workspaceName: string;
};

const MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    id: 'observatory',
    displayName: 'Observatory Module',
    description: 'Observatory ingest and analytics scenario implemented with the module toolkit.',
    workspacePath: 'modules/observatory',
    workspaceName: '@apphub/observatory-module'
  }
];

export function listModules(): ModuleCatalogEntry[] {
  return MODULE_CATALOG.map((entry) => ({ ...entry }));
}

export function getModuleById(id: string): ModuleCatalogEntry | null {
  const normalized = id.trim().toLowerCase();
  const entry = MODULE_CATALOG.find((candidate) => candidate.id === normalized);
  return entry ? { ...entry } : null;
}
