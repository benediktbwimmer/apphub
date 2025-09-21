import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { Command } from 'commander';
import { loadOrScaffoldBundle, packageBundle } from '../../lib/bundle';
import { writeJsonFile } from '../../lib/json';
import type { PackageResult } from '../../types';

const DEFAULT_REGISTRY_URL = 'http://127.0.0.1:4000';

type PublishOptions = {
  config?: string;
  slug?: string;
  version?: string;
  artifact?: string;
  token?: string;
  registryUrl?: string;
  capability?: string[];
  outputDir?: string;
  filename?: string;
  skipBuild?: boolean;
  minify?: boolean;
  force?: boolean;
};

function ensureToken(options: PublishOptions): string {
  const token = options.token || process.env.APPHUB_TOKEN;
  if (!token) {
    throw new Error('Publish token is required. Provide --token or set APPHUB_TOKEN.');
  }
  return token;
}

function resolveRegistryUrl(options: PublishOptions): string {
  const raw = options.registryUrl || process.env.APPHUB_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  return raw.replace(/\/+$/, '');
}

async function computeChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    const stream = file.createReadStream();
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

function collectCapability(value: string, previous: string[]): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return previous;
  }
  return [...previous, trimmed];
}

async function prepareArtifact(
  bundleDir: string,
  options: PublishOptions,
  packageCallback: () => Promise<PackageResult>
): Promise<{ path: string; checksum: string; packageResult?: PackageResult }>
{
  if (options.artifact) {
    const resolved = path.isAbsolute(options.artifact)
      ? options.artifact
      : path.resolve(process.cwd(), options.artifact);
    await fs.access(resolved);
    const checksum = await computeChecksum(resolved);
    return { path: resolved, checksum };
  }

  const result = await packageCallback();
  return { path: result.tarballPath, checksum: result.checksum, packageResult: result };
}

async function publishArtifact(
  registryUrl: string,
  token: string,
  payload: unknown
): Promise<unknown> {
  const response = await fetch(`${registryUrl}/job-bundles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error ? `: ${body.error}` : JSON.stringify(body, null, 2);
    } catch {
      const text = await response.text();
      detail = text ? `: ${text}` : '';
    }
    throw new Error(`Registry returned ${response.status}${detail}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

export function registerPublishCommand(jobs: Command): void {
  jobs
    .command('publish [directory]')
    .description('Publish a job bundle tarball to the registry')
    .option('--config <path>', 'Relative path to bundle config (default: apphub.bundle.json)')
    .option('--slug <slug>', 'Override the bundle slug before publishing')
    .option('--version <version>', 'Override manifest version before publishing')
    .option('--artifact <path>', 'Path to an existing tarball (skip packaging)')
    .option('--token <token>', 'Registry authentication token (falls back to APPHUB_TOKEN)')
    .option('--registry-url <url>', 'Job registry base URL (default: http://127.0.0.1:4000)')
    .option('--capability <flag>', 'Add a capability flag (may be repeated)', collectCapability, [])
    .option('--output-dir <path>', 'Directory for build artifacts (default: config.artifactDir)')
    .option('--filename <name>', 'Override tarball filename when packaging')
    .option('--skip-build', 'Reuse the existing dist directory instead of rebuilding')
    .option('--minify', 'Minify the compiled output during packaging')
    .option('--force', 'Overwrite existing tarball if packaging')
    .action(async (directory: string | undefined, opts: PublishOptions) => {
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      const token = ensureToken(opts);
      const registryUrl = resolveRegistryUrl(opts);
      const { context, created } = await loadOrScaffoldBundle(targetDir, {
        configPath: opts.config,
        slugOverride: opts.slug
      });

      if (created.length > 0) {
        console.log('Scaffolded bundle files:');
        for (const file of created) {
          console.log(`  • ${file}`);
        }
        console.log('Review the scaffolded files and update the manifest before publishing.');
      }

      if (opts.version) {
        const trimmed = opts.version.trim();
        if (!trimmed) {
          throw new Error('Version override cannot be empty.');
        }
        const existing = context.manifest.version;
        if (existing !== trimmed) {
          context.manifest.version = trimmed;
          await writeJsonFile(context.manifestPath, context.manifest);
          console.log(`Updated manifest version ${existing} → ${trimmed}`);
        }
      }

      const artifact = await prepareArtifact(targetDir, opts, async () =>
        packageBundle(context, {
          outputDir: opts.outputDir,
          filename: opts.filename,
          skipBuild: Boolean(opts.skipBuild),
          minify: Boolean(opts.minify),
          force: Boolean(opts.force)
        })
      );

      const manifestCapabilities = Array.isArray(context.manifest.capabilities)
        ? context.manifest.capabilities.filter((value) => typeof value === 'string')
        : [];
      const cliCapabilities = Array.isArray(opts.capability) ? opts.capability : [];
      const capabilitySet = new Set<string>();
      for (const flag of [...manifestCapabilities, ...cliCapabilities]) {
        const trimmed = flag.trim();
        if (trimmed) {
          capabilitySet.add(trimmed);
        }
      }

      const artifactBuffer = await fs.readFile(artifact.path);
      const base64Data = artifactBuffer.toString('base64');

      const payload = {
        slug: context.config.slug,
        version: context.manifest.version,
        manifest: context.manifest,
        capabilityFlags: Array.from(capabilitySet),
        description: context.manifest.description ?? undefined,
        displayName: context.manifest.name,
        metadata: context.manifest.metadata ?? undefined,
        artifact: {
          data: base64Data,
          filename: path.basename(artifact.path),
          contentType: 'application/gzip',
          checksum: artifact.checksum
        }
      };

      console.log(`Publishing ${context.config.slug}@${context.manifest.version} to ${registryUrl} ...`);
      const response = await publishArtifact(registryUrl, token, payload);
      console.log('Publish succeeded.');
      if (response && typeof response === 'object') {
        console.log(JSON.stringify(response, null, 2));
      } else if (typeof response === 'string' && response.trim()) {
        console.log(response.trim());
      }
    });
}
