import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import tar from 'tar';
import { runDockerCommand, type DockerResult } from './docker';

type ImageOverride = {
  root: string;
  reference: string | null;
};

type ImageExtractionResult = {
  directory: string;
  reference: string | null;
};

function parseImageOverrides(): Map<string, ImageOverride> {
  const raw = process.env.APPHUB_SERVICE_IMAGE_OVERRIDES;
  if (!raw) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return new Map();
    }

    const overrides = new Map<string, ImageOverride>();
    for (const [image, value] of Object.entries(parsed)) {
      if (!image || typeof image !== 'string') {
        continue;
      }

      if (typeof value === 'string') {
        const root = value.trim();
        if (!root) {
          continue;
        }
        overrides.set(image, {
          root: path.resolve(root),
          reference: null
        });
        continue;
      }

      if (!value || typeof value !== 'object') {
        continue;
      }

      const record = value as { root?: unknown; reference?: unknown; digest?: unknown };
      const rootValue = typeof record.root === 'string' ? record.root.trim() : '';
      if (!rootValue) {
        continue;
      }

      const referenceValue =
        typeof record.reference === 'string' && record.reference.trim()
          ? record.reference.trim()
          : typeof record.digest === 'string' && record.digest.trim()
            ? record.digest.trim()
            : null;

      overrides.set(image, {
        root: path.resolve(rootValue),
        reference: referenceValue
      });
    }

    return overrides;
  } catch {
    return new Map();
  }
}

function resolveImageOverride(image: string): ImageOverride | null {
  const overrides = parseImageOverrides();
  if (overrides.size === 0) {
    return null;
  }
  return overrides.get(image) ?? null;
}

async function assertDirectory(pathname: string): Promise<void> {
  const stats = await fs.stat(pathname);
  if (!stats.isDirectory()) {
    throw new Error(`image override root must be a directory: ${pathname}`);
  }
}

function ensureDockerSuccess(result: DockerResult, action: string): void {
  if (result.exitCode === 0) {
    return;
  }
  const detail = `${result.stderr || result.stdout}`.trim();
  throw new Error(detail || `docker ${action} failed`);
}

function normalizeDigestReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.includes('@')) {
    const [, digest] = trimmed.split('@');
    return digest?.trim() ?? trimmed;
  }
  return trimmed;
}

async function resolveImageDigest(image: string): Promise<string | null> {
  const digestResult = await runDockerCommand(['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image]);
  if (digestResult.exitCode === 0) {
    const digest = normalizeDigestReference(digestResult.stdout);
    if (digest) {
      return digest;
    }
  }

  const idResult = await runDockerCommand(['image', 'inspect', '--format', '{{.Id}}', image]);
  if (idResult.exitCode === 0) {
    const identifier = idResult.stdout.trim();
    if (identifier) {
      return identifier;
    }
  }

  return null;
}

async function copyOverrideContents(override: ImageOverride, destination: string): Promise<ImageExtractionResult> {
  await assertDirectory(override.root);
  const targetRoot = path.join(destination, 'image');
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.cp(override.root, targetRoot, { recursive: true });
  return { directory: targetRoot, reference: override.reference };
}

async function exportContainerFilesystem(containerId: string, destination: string): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  const exportProc = spawn('docker', ['export', containerId], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  exportProc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const extractor = tar.x({ cwd: destination });
  const pipelinePromise = pipeline(exportProc.stdout, extractor);

  const closeCode = await new Promise<number>((resolve, reject) => {
    exportProc.on('error', reject);
    exportProc.on('close', resolve);
  });

  await pipelinePromise;

  if (closeCode !== 0) {
    const message = stderr.trim() || `docker export exited with code ${closeCode}`;
    throw new Error(message);
  }
}

async function extractViaDocker(image: string, destination: string): Promise<ImageExtractionResult> {
  const createResult = await runDockerCommand(['create', image]);
  ensureDockerSuccess(createResult, 'create');
  const trimmedStdout = createResult.stdout.trim();
  const containerId = trimmedStdout ? trimmedStdout.split(/\s+/).pop() : undefined;
  if (!containerId) {
    throw new Error('docker create did not return a container id');
  }

  let resolvedReference: string | null = null;
  try {
    resolvedReference = await resolveImageDigest(image);
    const targetRoot = path.join(destination, 'image');
    await exportContainerFilesystem(containerId, targetRoot);
    return { directory: targetRoot, reference: resolvedReference };
  } finally {
    await runDockerCommand(['rm', '-f', containerId]);
  }
}

export async function extractDockerImageFilesystem(
  image: string,
  destination: string
): Promise<ImageExtractionResult> {
  const override = resolveImageOverride(image);
  if (override) {
    return copyOverrideContents(override, destination);
  }
  return extractViaDocker(image, destination);
}
