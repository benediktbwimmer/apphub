import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import {
  exampleConfigDescriptorSchema,
  type ExampleConfigDescriptor,
  type ExampleDescriptorManifest
} from './schema';

export type ExampleDescriptorFile = {
  configPath: string;
  directory: string;
  descriptor: ExampleConfigDescriptor;
};

export type BundleManifestReference = ExampleDescriptorManifest & {
  absolutePath: string;
};

export async function readExampleDescriptor(configPath: string): Promise<ExampleDescriptorFile> {
  const absoluteConfigPath = path.resolve(configPath);
  const contents = await fs.readFile(absoluteConfigPath, 'utf8');
  const parsed = exampleConfigDescriptorSchema.parse(JSON.parse(contents));
  return {
    configPath: absoluteConfigPath,
    directory: path.dirname(absoluteConfigPath),
    descriptor: parsed
  } satisfies ExampleDescriptorFile;
}

export function resolveBundleManifests(file: ExampleDescriptorFile): BundleManifestReference[] {
  const manifests = file.descriptor.manifests ?? [];
  const bundleEntries = manifests.filter((entry) => entry.kind === 'bundle' || !entry.kind);
  return bundleEntries.map((entry) => ({
    ...entry,
    absolutePath: path.resolve(file.directory, entry.path)
  }));
}

export async function readBundleSlugFromConfig(bundleConfigPath: string): Promise<string | null> {
  try {
    const payload = await fs.readFile(bundleConfigPath, 'utf8');
    const parsed = JSON.parse(payload) as { slug?: unknown };
    if (typeof parsed.slug === 'string') {
      const slug = parsed.slug.trim();
      return slug.length > 0 ? slug : null;
    }
  } catch {
    // ignore parse failures; caller can decide how to handle missing slugs
  }
  return null;
}

export async function discoverLocalDescriptorConfigs(
  workspaceRoot: string,
  patterns: string[] = ['examples/**/config.json']
): Promise<string[]> {
  const cwd = path.resolve(workspaceRoot);
  const matches = await fg(patterns, {
    cwd,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**']
  });
  return matches.map((relativePath) => path.resolve(cwd, relativePath));
}
