export type ModuleCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  workspacePath: string;
  workspaceName: string;
};

const MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    id: 'environmental-observatory',
    displayName: 'Environmental Observatory',
    description:
      'Reference implementation of the environmental observatory scenario using the AppHub module runtime.',
    workspacePath: 'modules/environmental-observatory',
    workspaceName: '@apphub/environmental-observatory-module'
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
