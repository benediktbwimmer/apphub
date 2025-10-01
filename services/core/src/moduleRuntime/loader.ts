import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

    if (!artifact.artifactPath || artifact.artifactStorage !== 'filesystem') {
      throw new Error(
        `Module artifact ${artifact.id} is not stored on the local filesystem and cannot be loaded`
      );
    }

    await this.ensureArtifactExists(artifact.artifactPath);

    const modulePath = path.resolve(artifact.artifactPath);
    const moduleUrl = pathToFileURL(modulePath).href;
    const imported = await import(moduleUrl);
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
