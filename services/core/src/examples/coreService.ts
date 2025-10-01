import path from 'node:path';
import {
  clearExampleCoreCache,
  loadExampleCore,
  type ExampleCoreData,
  type LoadCoreOptions
} from '@apphub/examples';

const DEFAULT_CACHE_TTL_MS = Number(process.env.APPHUB_EXAMPLES_CACHE_TTL_MS ?? 30_000);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

type CoreCacheState = {
  repoRoot: string;
  expiresAt: number;
  data: ExampleCoreData;
};

let state: CoreCacheState | null = null;

function resolveRepoRoot(repoRoot?: string): string {
  const override = repoRoot ?? process.env.APPHUB_REPO_ROOT;
  if (override) {
    return path.resolve(override);
  }
  return DEFAULT_REPO_ROOT;
}

function resolveTtlMillis(): number {
  const ttl = Number(process.env.APPHUB_EXAMPLES_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_MS;
}

async function refreshCore(options: LoadCoreOptions): Promise<ExampleCoreData> {
  const data = await loadExampleCore(options);
  return {
    jobs: Object.freeze([...data.jobs]),
    workflows: Object.freeze([...data.workflows]),
    scenarios: Object.freeze([...data.scenarios])
  } satisfies ExampleCoreData;
}

export async function getExampleCore(options: { repoRoot?: string; reload?: boolean } = {}): Promise<ExampleCoreData> {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const now = Date.now();
  const ttlMs = resolveTtlMillis();

  if (!options.reload && state && state.repoRoot === repoRoot && state.expiresAt > now) {
    return state.data;
  }

  const data = await refreshCore({ repoRoot, reload: options.reload });
  state = {
    repoRoot,
    data,
    expiresAt: now + ttlMs
  };
  return data;
}

export async function invalidateExampleCore(): Promise<void> {
  state = null;
  await clearExampleCoreCache();
}

export function getCachedExampleCore(): ExampleCoreData | null {
  if (state && state.expiresAt > Date.now()) {
    return state.data;
  }
  return null;
}
