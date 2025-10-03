import path from 'node:path';
import {
  clearModuleCatalogCache,
  loadModuleCatalog,
  type LoadCoreOptions,
  type ModuleCatalogData
} from '@apphub/module-registry';

const DEFAULT_CACHE_TTL_MS = Number(process.env.APPHUB_MODULES_CACHE_TTL_MS ?? 30_000);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

type CatalogCacheState = {
  repoRoot: string;
  expiresAt: number;
  data: ModuleCatalogData;
};

let state: CatalogCacheState | null = null;

function resolveRepoRoot(repoRoot?: string): string {
  const override = repoRoot ?? process.env.APPHUB_REPO_ROOT;
  if (override) {
    return path.resolve(override);
  }
  return DEFAULT_REPO_ROOT;
}

function resolveTtlMillis(): number {
  const ttl = Number(process.env.APPHUB_MODULES_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_MS;
}

async function refreshCatalog(options: LoadCoreOptions): Promise<ModuleCatalogData> {
  const data = await loadModuleCatalog(options);
  return {
    jobs: Object.freeze([...data.jobs]),
    workflows: Object.freeze([...data.workflows]),
    scenarios: Object.freeze([...data.scenarios])
  } satisfies ModuleCatalogData;
}

export async function getModuleCatalog(options: { repoRoot?: string; reload?: boolean } = {}): Promise<ModuleCatalogData> {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const now = Date.now();
  const ttlMs = resolveTtlMillis();

  if (!options.reload && state && state.repoRoot === repoRoot && state.expiresAt > now) {
    return state.data;
  }

  const data = await refreshCatalog({ repoRoot, reload: options.reload });
  state = {
    repoRoot,
    data,
    expiresAt: now + ttlMs
  } satisfies CatalogCacheState;
  return data;
}

export async function invalidateModuleCatalog(): Promise<void> {
  state = null;
  await clearModuleCatalogCache();
}

export function getCachedModuleCatalog(): ModuleCatalogData | null {
  if (state && state.expiresAt > Date.now()) {
    return state.data;
  }
  return null;
}
