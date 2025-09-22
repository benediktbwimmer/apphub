import path from 'node:path';
import { pathExists } from './fs';
import { readJsonFile, writeJsonFile } from './json';
import type { BundleConfig, NormalizedBundleConfig } from '../types';

export const DEFAULT_CONFIG_FILENAME = 'apphub.bundle.json';
export const DEFAULT_MANIFEST_PATH = 'manifest.json';
export const DEFAULT_SOURCE_ENTRY = 'src/index.ts';
export const DEFAULT_PYTHON_ENTRY = 'src/main.py';
export const DEFAULT_OUT_DIR = 'dist';
export const DEFAULT_ARTIFACT_DIR = 'artifacts';
export const DEFAULT_FILES = ['manifest.json', 'dist/**/*'];
export const DEFAULT_SAMPLE_INPUT_PATH = 'tests/sample-input.json';
export const DEFAULT_PYTHON_REQUIREMENTS_PATH = 'requirements.txt';

export async function loadBundleConfig(
  bundleDir: string,
  configPath?: string
): Promise<BundleConfig | null> {
  const resolved = path.resolve(bundleDir, configPath ?? DEFAULT_CONFIG_FILENAME);
  if (!(await pathExists(resolved))) {
    return null;
  }
  const config = await readJsonFile<BundleConfig>(resolved);
  return config;
}

export async function saveBundleConfig(
  bundleDir: string,
  config: BundleConfig,
  configPath?: string
): Promise<void> {
  const resolved = path.resolve(bundleDir, configPath ?? DEFAULT_CONFIG_FILENAME);
  await writeJsonFile(resolved, config);
}

export function normalizeBundleConfig(
  bundleDir: string,
  config: BundleConfig,
  overrides: Partial<BundleConfig> = {}
): NormalizedBundleConfig {
  const merged: BundleConfig = {
    ...config,
    ...overrides
  };

  const slug = (overrides.slug ?? config.slug)?.trim();
  if (!slug) {
    throw new Error('Bundle config must include a slug');
  }

  const entry = merged.entry?.trim() || DEFAULT_SOURCE_ENTRY;
  const outDir = merged.outDir?.trim() || DEFAULT_OUT_DIR;
  const manifestPath = merged.manifestPath?.trim() || DEFAULT_MANIFEST_PATH;
  const artifactDir = merged.artifactDir?.trim() || DEFAULT_ARTIFACT_DIR;
  const files = merged.files && merged.files.length > 0 ? merged.files : DEFAULT_FILES;
  const tests = merged.tests ?? {};
  const pythonEntry = merged.pythonEntry?.trim() || DEFAULT_PYTHON_ENTRY;
  const pythonRequirementsPath = merged.pythonRequirementsPath?.trim();

  return {
    slug,
    entry,
    outDir,
    manifestPath,
    artifactDir,
    files,
    tests,
    pythonEntry,
    pythonRequirementsPath
  } satisfies NormalizedBundleConfig;
}

export function resolvePath(bundleDir: string, relativePath: string): string {
  return path.resolve(bundleDir, relativePath);
}
