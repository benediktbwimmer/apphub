import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import { materializeObservatoryConfig } from '../src/deployment/config';
import type { EventDrivenObservatoryConfig } from '../src/deployment/configBuilder';

const DEFAULT_CORE_URL = 'http://core-api:4000';

function resolveCoreAuth(): { coreUrl: string; coreToken: string } {
  const coreUrl = (process.env.OBSERVATORY_CORE_BASE_URL ?? process.env.APPHUB_CORE_URL ?? DEFAULT_CORE_URL).trim();
  const token =
    process.env.OBSERVATORY_CORE_TOKEN ??
    process.env.APPHUB_CORE_TOKEN ??
    process.env.APPHUB_DEMO_SERVICE_TOKEN ??
    process.env.APPHUB_DEMO_ADMIN_TOKEN ??
    '';

  if (!token.trim()) {
    throw new Error('OBSERVATORY_CORE_TOKEN or APPHUB_CORE_TOKEN must be set to publish the module.');
  }

  return { coreUrl, coreToken: token.trim() };
}

type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

const logger: Logger = {
  debug(message, meta) {
    if (process.env.LOG_LEVEL === 'debug') {
      // eslint-disable-next-line no-console
      console.debug('[observatory-deploy]', message, meta ?? {});
    }
  },
  info(message, meta) {
    // eslint-disable-next-line no-console
    console.info('[observatory-deploy]', message, meta ?? {});
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error('[observatory-deploy]', message, meta ?? {});
  }
};

function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleDir = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(scriptDir, '..', '..', '..');

  await prepareFilesystem(process.env);

  const { config } = await materializeObservatoryConfig({
    repoRoot: moduleDir,
    env: process.env,
    logger
  });

  const { coreUrl, coreToken } = resolveCoreAuth();

  if (process.env.OBSERVATORY_SKIP_BUILD !== '1') {
    await runCommand('npm', ['run', 'build', '--workspace', '@apphub/observatory-module'], {
      cwd: repoRoot
    });
  }

  if (process.env.OBSERVATORY_BUILD_CLI !== '0') {
    await runCommand('npm', ['run', 'build', '--workspace', '@apphub/cli'], { cwd: repoRoot });
  }

  await runCommand(
    'node',
    [
      path.join(repoRoot, 'apps/cli/dist/index.js'),
      'module',
      'deploy',
      '--module',
      moduleDir,
      '--core-url',
      coreUrl,
      '--core-token',
      coreToken
    ],
    { cwd: repoRoot }
  );

  await seedCalibrations(config, process.env);
  await triggerCalibrationImports(config, process.env, { coreUrl, coreToken });
}

async function prepareFilesystem(env: NodeJS.ProcessEnv): Promise<void> {
  const directories = new Set<string>();

  const addDir = (value: string | undefined, opts: { treatAsFile?: boolean } = {}) => {
    const candidate = value?.trim();
    if (!candidate) {
      return;
    }
    if (/^[a-z]+:\/\/|^azure:\/\//i.test(candidate)) {
      return;
    }
    const target = opts.treatAsFile ? path.dirname(candidate) : candidate;
    directories.add(path.resolve(target));
  };

  addDir(env.APPHUB_SCRATCH_ROOT);
  addDir(env.OBSERVATORY_DATA_ROOT);
  addDir(env.TIMESTORE_STORAGE_ROOT);
  addDir(env.TIMESTORE_QUERY_CACHE_DIR);
  addDir(env.TIMESTORE_STAGING_DIRECTORY);
  addDir(env.OBSERVATORY_CONFIG_OUTPUT, { treatAsFile: true });

  for (const dir of directories) {
    await mkdir(dir, { recursive: true });
  }
}

async function seedCalibrations(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const backendId = config.filestore.backendMountId ?? null;
  const prefixRaw = config.filestore.calibrationsPrefix ?? '';

  if (!backendId || !prefixRaw.trim()) {
    logger.info('Skipping calibration seeding; filestore backend not configured', {
      backendId,
      prefix: prefixRaw
    });
    return;
  }

  const baseUrl = resolveFilestoreBaseUrl(config, env);
  if (!baseUrl) {
    logger.info('Skipping calibration seeding; filestore base URL unavailable');
    return;
  }

  const token = resolveFilestoreToken(config, env);
  const client = new FilestoreClient({
    baseUrl,
    token: token ?? undefined,
    userAgent: 'observatory-bootstrap/calibration-seed',
    fetchTimeoutMs: 30_000
  });

  const principal = env.OBSERVATORY_CALIBRATION_IMPORT_PRINCIPAL?.trim() || 'observatory-calibration-importer';
  const prefix = prefixRaw.replace(/^\/+|\/+$/g, '');

  logger.info('Ensuring calibration directory hierarchy', {
    backendId,
    prefix,
    principal,
    baseUrl,
    tokenProvided: Boolean(token),
    envBaseUrl: env.OBSERVATORY_FILESTORE_BASE_URL ?? null,
    configBaseUrl: config.filestore.baseUrl ?? null
  });

  try {
    await ensureDirectoryHierarchy(client, backendId, prefix, principal);
  } catch (error) {
    if (error instanceof FilestoreClientError) {
      logger.error('Failed to ensure calibration directory hierarchy', {
        statusCode: error.statusCode,
        code: error.code,
        details: error.details
      });
    }
    throw error;
  }

  const targetCount = resolveInstrumentCount(config, env);
  const seeds = DEFAULT_CALIBRATION_SEEDS.slice(0, targetCount);

  logger.info('Seeding observatory calibration files', {
    instrumentCount: seeds.length,
    prefix,
    backendId
  });

  for (const seed of seeds) {
    const calibrationFile = buildCalibrationFile(seed);
    const content = `${JSON.stringify(calibrationFile, null, 2)}\n`;
    const filename = buildCalibrationFilename(seed.instrumentId, calibrationFile.effectiveAt);
    const targetPath = `${prefix}/${filename}`;

    const existing = await fetchExistingCalibration(client, backendId, targetPath, principal);
    if (existing === content) {
      logger.info('Calibration seed already up to date; refreshing upload', {
        instrumentId: seed.instrumentId,
        path: targetPath
      });
    }

    try {
      await client.uploadFile({
        backendMountId: backendId,
        path: targetPath,
        content,
        contentType: 'application/json; charset=utf-8',
        overwrite: true,
        principal,
        metadata: {
          instrumentId: seed.instrumentId,
          effectiveAt: calibrationFile.effectiveAt,
          createdAt: calibrationFile.createdAt ?? null,
          site: seed.site,
          seededBy: 'observatory-bootstrap',
          revision: calibrationFile.revision ?? null
        }
      });
      logger.info('Uploaded calibration seed', { instrumentId: seed.instrumentId, path: targetPath });
    } catch (error) {
      if (error instanceof FilestoreClientError) {
        logger.error('Failed to upload calibration seed', {
          instrumentId: seed.instrumentId,
          path: targetPath,
          statusCode: error.statusCode,
          code: error.code,
          details: error.details
        });
      }
      throw error;
    }
  }
}

async function triggerCalibrationImports(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv,
  coreAuth: { coreUrl: string; coreToken: string }
): Promise<void> {
  const backendId = config.filestore.backendMountId ?? null;
  const prefixRaw = config.filestore.calibrationsPrefix ?? '';
  if (!backendId || !prefixRaw.trim()) {
    logger.info('Skipping calibration import workflow execution; filestore backend not configured');
    return;
  }

  const baseUrl = resolveFilestoreBaseUrl(config, env);
  const token = resolveFilestoreToken(config, env);

  const client = new FilestoreClient({
    baseUrl: baseUrl ?? 'http://filestore:4300',
    token: token ?? undefined,
    userAgent: 'observatory-bootstrap/calibration-import'
  });

  const prefix = prefixRaw.replace(/^\/+|\/+$/g, '');
  const seeds = DEFAULT_CALIBRATION_SEEDS;

  for (const seed of seeds) {
    const calibrationFile = buildCalibrationFile(seed);
    const filename = buildCalibrationFilename(seed.instrumentId, calibrationFile.effectiveAt);
    const filestorePath = `${prefix}/${filename}`;

    let nodeId: number | null = null;
    let checksum: string | undefined;
    try {
      const node = await client.getNodeByPath({ backendMountId: backendId, path: filestorePath });
      nodeId = node.id ?? null;
      const rawChecksum =
        typeof node.checksum === 'string' && node.checksum.length > 0
          ? node.checksum
          : typeof node.contentHash === 'string' && node.contentHash.length > 0
            ? node.contentHash
            : undefined;
      checksum = rawChecksum;
    } catch (error) {
      if (error instanceof FilestoreClientError && error.statusCode === 404) {
        logger.error('Calibration file missing; cannot trigger import', {
          instrumentId: seed.instrumentId,
          path: filestorePath
        });
        continue;
      }
      throw error;
    }

    const payload = {
      parameters: {
        calibrationPath: filestorePath,
        calibrationNodeId: nodeId,
        checksum
      },
      triggeredBy: 'observatory-bootstrap:calibration-seed'
    } satisfies Record<string, unknown>;

    try {
      const response = await fetch(`${coreAuth.coreUrl.replace(/\/$/, '')}/workflows/observatory-calibration-import/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${coreAuth.coreToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`HTTP ${response.status} ${detail}`);
      }

      logger.info('Enqueued calibration import workflow', {
        instrumentId: seed.instrumentId,
        path: filestorePath
      });
    } catch (error) {
      logger.error('Failed to enqueue calibration import workflow', {
        instrumentId: seed.instrumentId,
        path: filestorePath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

type CalibrationSeed = {
  instrumentId: string;
  site: string;
  offsets: Record<string, number>;
  scales?: Record<string, number> | null;
  notes: string;
};

type CalibrationFile = {
  instrumentId: string;
  effectiveAt: string;
  createdAt?: string;
  revision?: number;
  offsets: Record<string, number>;
  scales?: Record<string, number> | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

const DEFAULT_CALIBRATION_SEEDS: CalibrationSeed[] = [
  {
    instrumentId: 'instrument_alpha',
    site: 'west-basin',
    offsets: {
      temperature_c: -0.3,
      relative_humidity_pct: 0.6,
      pm2_5_ug_m3: -0.8,
      battery_voltage: 0.04
    },
    scales: {
      temperature_c: 1.01,
      pm2_5_ug_m3: 1.03
    },
    notes: 'Initial calibration sweep for west basin sensor pack.'
  },
  {
    instrumentId: 'instrument_bravo',
    site: 'east-ridge',
    offsets: {
      temperature_c: -0.1,
      relative_humidity_pct: 0.4,
      pm2_5_ug_m3: -0.5,
      battery_voltage: 0.02
    },
    scales: {
      temperature_c: 1,
      relative_humidity_pct: 0.99
    },
    notes: 'Quarterly field calibration captured before deployment.'
  },
  {
    instrumentId: 'instrument_charlie',
    site: 'north-forest',
    offsets: {
      temperature_c: -0.25,
      relative_humidity_pct: 0.7,
      pm2_5_ug_m3: -0.4,
      battery_voltage: 0.03
    },
    scales: {
      relative_humidity_pct: 1.01
    },
    notes: 'Forest canopy calibration after sensor maintenance.'
  }
];

function buildCalibrationFile(seed: CalibrationSeed): CalibrationFile {
  const effectiveAt = '2025-01-01T00:00:00Z';
  const createdAt = '2025-01-05T12:00:00Z';

  return {
    instrumentId: seed.instrumentId,
    effectiveAt,
    createdAt,
    revision: 1,
    offsets: seed.offsets,
    scales: seed.scales ?? undefined,
    notes: seed.notes,
    metadata: {
      site: seed.site,
      seededBy: 'observatory-bootstrap',
      campaign: 'initial-load'
    }
  } satisfies CalibrationFile;
}

function buildCalibrationFilename(instrumentId: string, effectiveAtIso: string): string {
  const sanitized = sanitizeIdentifier(instrumentId) || 'calibration';
  const iso = new Date(effectiveAtIso).toISOString();
  const timestamp = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${sanitized}_${timestamp}.json`;
}

function resolveFilestoreBaseUrl(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv
): string | null {
  const candidates = [
    env.OBSERVATORY_FILESTORE_BASE_URL,
    env.FILESTORE_BASE_URL,
    config.filestore.baseUrl
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed.replace(/\/+$/, '');
    }
  }

  return null;
}

function resolveFilestoreToken(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv
): string | null {
  const candidates = [
    env.OBSERVATORY_CALIBRATIONS_TOKEN,
    env.OBSERVATORY_FILESTORE_TOKEN,
    env.FILESTORE_TOKEN,
    env.APPHUB_DEMO_SERVICE_TOKEN,
    config.filestore.token ?? undefined
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function resolveInstrumentCount(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv
): number {
  const envCandidates = [env.OBSERVATORY_INSTRUMENT_COUNT, env.OBSERVATORY_GENERATOR_INSTRUMENT_COUNT];
  for (const candidate of envCandidates) {
    if (!candidate) {
      continue;
    }
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, DEFAULT_CALIBRATION_SEEDS.length);
    }
  }

  const configured = config.workflows.generator?.instrumentCount;
  if (configured && configured > 0) {
    return Math.min(configured, DEFAULT_CALIBRATION_SEEDS.length);
  }

  return DEFAULT_CALIBRATION_SEEDS.length;
}

async function ensureDirectoryHierarchy(
  client: FilestoreClient,
  backendMountId: number,
  prefix: string,
  principal: string | null
): Promise<void> {
  const segments = prefix.split('/').filter(Boolean);
  let current = '';

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        principal: principal ?? undefined,
        idempotencyKey: `observatory-calibration-dir-${current}`
      });
    } catch (error) {
      if (
        error instanceof FilestoreClientError &&
        (error.statusCode === 409 || (error.code ?? '').toLowerCase() === 'directory_exists')
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function fetchExistingCalibration(
  client: FilestoreClient,
  backendMountId: number,
  path: string,
  principal: string | null
): Promise<string | null> {
  try {
    const node = await client.getNodeByPath({ backendMountId, path });
    if (!node || node.kind !== 'file') {
      return null;
    }

    const download = await client.downloadFile(node.id, { principal: principal ?? undefined });
    return await streamToString(download.stream);
  } catch (error) {
    if (
      error instanceof FilestoreClientError &&
      (error.statusCode === 404 || (error.code ?? '').toLowerCase().includes('not_found'))
    ) {
      return null;
    }
    throw error;
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Buffer) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[observatory-deploy] Failed to publish module:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
