import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import Module from 'module';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  getModuleArtifact,
  getModuleTarget
} from '../db/modules';
import type {
  ModuleTargetBinding,
  ModuleArtifactRecord,
  ModuleTargetRecord
} from '../db/types';
import type {
  ModuleDefinition,
  ModuleManifest,
  ModuleTargetDefinition
} from '@apphub/module-sdk';

type LoadedModuleInstance = {
  moduleId: string;
  moduleVersion: string;
  artifact: ModuleArtifactRecord;
  definition: ModuleDefinition;
  manifest: ModuleManifest;
  targetMap: Map<string, ModuleTargetDefinition<unknown, unknown>>;
  loadedAt: number;
};

export type LoadedModuleTarget = {
  module: LoadedModuleInstance;
  target: ModuleTargetDefinition<unknown, unknown>;
  metadata: ModuleTargetRecord;
};

export interface ModuleRuntimeLoaderOptions {
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

const moduleConstructor = Module as unknown as { globalPaths: string[]; _initPaths?: () => void };

const moduleResolveCandidates: string[] = (process.env.APPHUB_MODULE_RESOLVE_PATHS ?? '/app/node_modules')
  .split(':')
  .map((entry: string) => entry.trim())
  .filter((entry: string) => entry.length > 0)
  .map((entry: string) => path.resolve(entry));

const moduleArtifactCacheRoot = (() => {
  const artifactsRoot = (process.env.APPHUB_MODULE_ARTIFACTS_DIR ?? '').trim();
  if (artifactsRoot) {
    return path.resolve(artifactsRoot);
  }
  const scratchRoot = (process.env.APPHUB_SCRATCH_ROOT ?? '').trim();
  if (scratchRoot) {
    return path.resolve(scratchRoot, 'module-artifacts');
  }
  return path.join(os.tmpdir(), 'apphub-modules');
})();

const moduleArtifactS3Region =
  process.env.APPHUB_MODULE_ARTIFACT_REGION?.trim() ||
  process.env.APPHUB_MODULE_ARTIFACT_S3_REGION?.trim() ||
  process.env.APPHUB_BUNDLE_STORAGE_REGION?.trim() ||
  process.env.AWS_REGION?.trim() ||
  'us-east-1';

const moduleArtifactS3Endpoint =
  process.env.APPHUB_MODULE_ARTIFACT_ENDPOINT?.trim() ||
  process.env.APPHUB_MODULE_ARTIFACT_S3_ENDPOINT?.trim() ||
  process.env.APPHUB_BUNDLE_STORAGE_ENDPOINT?.trim() ||
  process.env.APPHUB_JOB_BUNDLE_S3_ENDPOINT?.trim() ||
  undefined;

const moduleArtifactS3ForcePathStyle =
  (process.env.APPHUB_MODULE_ARTIFACT_FORCE_PATH_STYLE ??
    process.env.APPHUB_MODULE_ARTIFACT_S3_FORCE_PATH_STYLE ??
    process.env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE ??
    process.env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE ??
    'false')
    .toLowerCase()
    .trim() === 'true';

const moduleArtifactS3AccessKeyId =
  process.env.APPHUB_MODULE_ARTIFACT_ACCESS_KEY_ID ??
  process.env.APPHUB_MODULE_ARTIFACT_S3_ACCESS_KEY_ID ??
  process.env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ??
  process.env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ??
  process.env.AWS_ACCESS_KEY_ID ??
  undefined;

const moduleArtifactS3SecretAccessKey =
  process.env.APPHUB_MODULE_ARTIFACT_SECRET_ACCESS_KEY ??
  process.env.APPHUB_MODULE_ARTIFACT_S3_SECRET_ACCESS_KEY ??
  process.env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ??
  process.env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY ??
  undefined;

const moduleArtifactS3SessionToken =
  process.env.APPHUB_MODULE_ARTIFACT_SESSION_TOKEN ??
  process.env.APPHUB_MODULE_ARTIFACT_S3_SESSION_TOKEN ??
  process.env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN ??
  process.env.APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN ??
  process.env.AWS_SESSION_TOKEN ??
  undefined;

let moduleArtifactS3Client: S3Client | null = null;

function ensureModuleResolutionPaths(): void {
  if (moduleResolveCandidates.length === 0) {
    return;
  }
  const existing = new Set(moduleConstructor.globalPaths.map((entry: string) => path.resolve(entry)));
  let updated = false;
  for (const candidate of moduleResolveCandidates) {
    if (!existing.has(candidate)) {
      moduleConstructor.globalPaths.push(candidate);
      existing.add(candidate);
      updated = true;
    }
  }
  if (updated && typeof moduleConstructor._initPaths === 'function') {
    const currentNodePath = process.env.NODE_PATH
      ? process.env.NODE_PATH.split(path.delimiter).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
      : [];
    const merged = new Set([...currentNodePath.map((entry) => path.resolve(entry)), ...moduleConstructor.globalPaths]);
    process.env.NODE_PATH = Array.from(merged).join(path.delimiter);
    moduleConstructor._initPaths();
  }
}

function sanitizeForPathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase();
}

function sanitizeFilename(value: string): string {
  const base = path.basename(value || 'module.js');
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function parseS3ArtifactPath(artifactPath: string): { bucket: string; key: string } {
  const trimmed = artifactPath.trim();
  if (!trimmed) {
    throw new Error('Module artifact path is empty');
  }

  if (trimmed.startsWith('s3://')) {
    const url = new URL(trimmed);
    const key = url.pathname.replace(/^\/+/, '');
    if (!url.hostname || !key) {
      throw new Error(`Invalid S3 artifact path: ${artifactPath}`);
    }
    return { bucket: url.hostname, key };
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(`Invalid S3 artifact path: ${artifactPath}`);
  }
  const bucket = trimmed.slice(0, slashIndex);
  const key = trimmed.slice(slashIndex + 1);
  return { bucket, key };
}

function getModuleArtifactS3Client(): S3Client {
  if (!moduleArtifactS3Client) {
    const config: ConstructorParameters<typeof S3Client>[0] = {
      region: moduleArtifactS3Region,
      forcePathStyle: moduleArtifactS3ForcePathStyle
    };
    if (moduleArtifactS3Endpoint) {
      config.endpoint = moduleArtifactS3Endpoint;
    }
    if (moduleArtifactS3AccessKeyId && moduleArtifactS3SecretAccessKey) {
      config.credentials = {
        accessKeyId: moduleArtifactS3AccessKeyId,
        secretAccessKey: moduleArtifactS3SecretAccessKey,
        sessionToken: moduleArtifactS3SessionToken
      };
    }
    moduleArtifactS3Client = new S3Client(config);
  }
  return moduleArtifactS3Client;
}

async function downloadS3ObjectToFile(params: { bucket: string; key: string; destination: string }): Promise<void> {
  const client = getModuleArtifactS3Client();
  const command = new GetObjectCommand({ Bucket: params.bucket, Key: params.key });
  const response = await client.send(command);
  const body = response.Body;
  if (!body) {
    throw new Error(`Empty response body when downloading module artifact s3://${params.bucket}/${params.key}`);
  }

  await fs.mkdir(path.dirname(params.destination), { recursive: true });

  if (typeof (body as any).pipe === 'function') {
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(params.destination);
      stream.on('error', reject);
      stream.on('close', resolve);
      (body as NodeJS.ReadableStream).on('error', reject).pipe(stream);
    });
    return;
  }

  if (typeof (body as any).transformToByteArray === 'function') {
    const array = await (body as any).transformToByteArray();
    await fs.writeFile(params.destination, Buffer.from(array));
    return;
  }

  if (typeof (body as any).arrayBuffer === 'function') {
    const buffer = await (body as any).arrayBuffer();
    await fs.writeFile(params.destination, Buffer.from(buffer));
    return;
  }

  throw new Error('Unsupported S3 response body type for module artifact download');
}

export class ModuleRuntimeLoader {
  private readonly cache = new Map<string, Promise<LoadedModuleInstance>>();
  private readonly cacheTtlMs: number;

  constructor(options: ModuleRuntimeLoaderOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getTarget(binding: ModuleTargetBinding): Promise<LoadedModuleTarget> {
    const targetRecord = await getModuleTarget({
      moduleId: binding.moduleId,
      moduleVersion: binding.moduleVersion,
      targetName: binding.targetName,
      targetVersion: binding.targetVersion
    });

    if (!targetRecord) {
      throw new Error(
        `Module target not found: ${binding.moduleId}@${binding.moduleVersion}:${binding.targetName}@${binding.targetVersion}`
      );
    }

    if (!targetRecord.module.isEnabled) {
      throw new Error(
        `Module ${binding.moduleId}@${binding.moduleVersion} is disabled`
      );
    }

    const module = await this.loadModule(binding.moduleId, binding.moduleVersion, targetRecord.artifact);

    const key = this.buildTargetKey(binding.targetName, binding.targetVersion);
    const target = module.targetMap.get(key);
    if (!target) {
      throw new Error(
        `Loaded module ${binding.moduleId}@${binding.moduleVersion} does not export target ${binding.targetName}@${binding.targetVersion}`
      );
    }

    return {
      module,
      target,
      metadata: targetRecord.target
    } satisfies LoadedModuleTarget;
  }

  invalidate(moduleId: string, moduleVersion?: string): void {
    if (moduleVersion) {
      this.cache.delete(this.buildModuleKey(moduleId, moduleVersion));
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${moduleId}@`)) {
        this.cache.delete(key);
      }
    }
  }

  private buildModuleKey(moduleId: string, moduleVersion: string): string {
    return `${moduleId}@${moduleVersion}`;
  }

  private buildTargetKey(targetName: string, targetVersion: string | null | undefined): string {
    const normalizedName = targetName.trim();
    const version = targetVersion?.trim();
    return `${normalizedName}@${version ?? 'latest'}`;
  }

  private async loadModule(
    moduleId: string,
    moduleVersion: string,
    artifactRecord?: ModuleArtifactRecord
  ): Promise<LoadedModuleInstance> {
    const cacheKey = this.buildModuleKey(moduleId, moduleVersion);
    const existing = this.cache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = this.loadModuleInternal(moduleId, moduleVersion, artifactRecord)
      .then(async (instance) => {
        if (this.cacheTtlMs > 0) {
          const handle = setTimeout(() => {
            const cached = this.cache.get(cacheKey);
            if (cached === promise) {
              this.cache.delete(cacheKey);
            }
          }, this.cacheTtlMs);
          if (typeof (handle as NodeJS.Timeout).unref === 'function') {
            (handle as NodeJS.Timeout).unref();
          }
        }
        return instance;
      })
      .catch((error) => {
        this.cache.delete(cacheKey);
        throw error;
      });

    this.cache.set(cacheKey, promise);
    return promise;
  }

  private async loadModuleInternal(
    moduleId: string,
    moduleVersion: string,
    artifactRecord?: ModuleArtifactRecord
  ): Promise<LoadedModuleInstance> {
    const artifact =
      artifactRecord ?? (await getModuleArtifact({ moduleId, moduleVersion }));
    if (!artifact) {
      throw new Error(`Module artifact not found for ${moduleId}@${moduleVersion}`);
    }

    let modulePath: string;
    if (!artifact.artifactPath) {
      throw new Error(`Module artifact ${artifact.id} is missing an artifact path`);
    }

    if (artifact.artifactStorage === 'filesystem') {
      await this.ensureArtifactExists(artifact.artifactPath);
      modulePath = path.resolve(artifact.artifactPath);
    } else if (artifact.artifactStorage === 's3') {
      modulePath = await this.ensureS3ArtifactMaterialized(moduleId, moduleVersion, artifact);
    } else {
      throw new Error(
        `Module artifact ${artifact.id} uses unsupported storage backend ${artifact.artifactStorage}`
      );
    }

    ensureModuleResolutionPaths();
    const imported = await import(modulePath);
    const definition: ModuleDefinition | undefined = (imported?.default ?? imported) as ModuleDefinition;

    if (!definition || typeof definition !== 'object' || !definition.metadata) {
      throw new Error(`Module bundle at ${modulePath} did not export a module definition`);
    }

    if (definition.metadata.name !== moduleId) {
      throw new Error(
        `Loaded module name mismatch: expected ${moduleId}, received ${definition.metadata.name}`
      );
    }

    if (definition.metadata.version !== moduleVersion) {
      throw new Error(
        `Loaded module version mismatch: expected ${moduleVersion}, received ${definition.metadata.version}`
      );
    }

    const manifestValue = artifact.manifest as unknown;
    if (!manifestValue || typeof manifestValue !== 'object') {
      throw new Error(`Module artifact ${artifact.id} is missing manifest data`);
    }
    const manifest = manifestValue as ModuleManifest;
    const targetMap = new Map<string, ModuleTargetDefinition<unknown, unknown>>();
    for (const target of definition.targets ?? []) {
      const targetName = target.name?.trim();
      const targetVersion = target.version?.trim();
      if (!targetName || !targetVersion) {
        continue;
      }
      targetMap.set(this.buildTargetKey(targetName, targetVersion), target as ModuleTargetDefinition<unknown, unknown>);
    }

    if (!artifact.targets || artifact.targets.length === 0) {
      const refreshed = await getModuleArtifact({ moduleId, moduleVersion });
      if (refreshed) {
        artifact.targets = refreshed.targets ?? [];
      }
    }

    return {
      moduleId,
      moduleVersion,
      artifact,
      definition,
      manifest,
      targetMap,
      loadedAt: Date.now()
    } satisfies LoadedModuleInstance;
  }

  private async ensureS3ArtifactMaterialized(
    moduleId: string,
    moduleVersion: string,
    artifact: ModuleArtifactRecord
  ): Promise<string> {
    const { bucket, key } = parseS3ArtifactPath(artifact.artifactPath);
    const sanitizedModule = sanitizeForPathSegment(moduleId);
    const sanitizedVersion = sanitizeForPathSegment(moduleVersion);
    const filename = sanitizeFilename(path.basename(key) || 'module.js');
    const cacheDir = path.join(moduleArtifactCacheRoot, sanitizedModule, sanitizedVersion);
    const cachePath = path.join(cacheDir, filename);

    const expectedChecksum = artifact.artifactChecksum?.trim() || null;
    let checksumMatches = false;

    if (await fileExists(cachePath)) {
      if (!expectedChecksum) {
        checksumMatches = true;
      } else {
        const currentChecksum = await computeFileChecksum(cachePath);
        checksumMatches = currentChecksum === expectedChecksum;
      }
    }

    if (!checksumMatches) {
      await downloadS3ObjectToFile({ bucket, key, destination: cachePath });
      if (expectedChecksum) {
        const downloadedChecksum = await computeFileChecksum(cachePath);
        if (downloadedChecksum !== expectedChecksum) {
          await fs.rm(cachePath, { force: true }).catch(() => undefined);
          throw new Error(
            `Downloaded module artifact checksum mismatch for ${artifact.id} (${downloadedChecksum} !== ${expectedChecksum})`
          );
        }
      }
    }

    return cachePath;
  }

  private async ensureArtifactExists(artifactPath: string): Promise<void> {
    try {
      await fs.access(artifactPath);
    } catch (error) {
      const err = new Error(`Module artifact not accessible at ${artifactPath}`);
      (err as { cause?: unknown }).cause = error;
      throw err;
    }
  }
}
