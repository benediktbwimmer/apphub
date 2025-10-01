import process from 'node:process';
import {
  closePool,
  ensureDatabase,
  getJobDefinitionBySlug,
  getModuleArtifact,
  getModuleTarget,
  listModules,
  setModuleEnablement,
  upsertJobDefinition,
  type ModuleTargetBinding
} from '../db';
import type { ModuleRecord } from '../db/types';

interface PinJobOptions {
  jobSlug: string | null;
  moduleId: string | null;
  moduleVersion: string | null;
  targetName: string | null;
  targetVersion: string | null;
}

interface CliOptions {
  mode: 'list' | 'show-targets' | 'enable' | 'disable' | 'pin-job' | null;
  moduleId?: string | null;
  moduleVersion?: string | null;
  jobSlug?: string | null;
  targetName?: string | null;
  targetVersion?: string | null;
  databaseUrl?: string | null;
  help?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: null };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    switch (arg) {
      case '--list':
        if (options.mode && options.mode !== 'list') {
          throw new Error('Only one command may be specified per invocation.');
        }
        options.mode = 'list';
        break;
      case '--show-targets':
        if (options.mode && options.mode !== 'show-targets') {
          throw new Error('Only one command may be specified per invocation.');
        }
        options.mode = 'show-targets';
        options.moduleId = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--enable':
        if (options.mode && options.mode !== 'enable') {
          throw new Error('Only one command may be specified per invocation.');
        }
        options.mode = 'enable';
        options.moduleId = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--disable':
        if (options.mode && options.mode !== 'disable') {
          throw new Error('Only one command may be specified per invocation.');
        }
        options.mode = 'disable';
        options.moduleId = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--pin-job':
        if (options.mode && options.mode !== 'pin-job') {
          throw new Error('Only one command may be specified per invocation.');
        }
        options.mode = 'pin-job';
        options.jobSlug = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--module':
        options.moduleId = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--module-version':
        options.moduleVersion = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--target':
        options.targetName = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--target-version':
        options.targetVersion = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--database-url':
        options.databaseUrl = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: npm run module:admin -- [command] [options]\n\nCommands:\n  --list                             List registered modules and status\n  --show-targets <moduleId>          List targets for a module (use --module-version to override latest)\n  --enable <moduleId>                Mark a module as enabled\n  --disable <moduleId>               Mark a module as disabled\n  --pin-job <jobSlug>                Pin a job definition to a module target\n\nOptions:\n  --module <moduleId>                Module identifier (for pin-job)\n  --module-version <semver>          Module version to inspect\n  --target <name>                    Target name when pinning\n  --target-version <semver>          Target version when pinning\n  --database-url <url>               Override DATABASE_URL\n  --help, -h                         Show this help message`);
}

function formatModule(module: ModuleRecord): string {
  const status = module.isEnabled ? 'enabled' : 'disabled';
  const version = module.latestVersion ?? 'n/a';
  return `${module.id} @ ${version} (${status})`;
}

async function handleList(): Promise<void> {
  const modules = await listModules();
  if (modules.length === 0) {
    console.log('No modules published yet.');
    return;
  }
  console.log('Modules:');
  for (const module of modules) {
    console.log(`  - ${formatModule(module)}`);
  }
}

async function handleShowTargets(moduleId: string | null, moduleVersionHint: string | null): Promise<void> {
  if (!moduleId) {
    throw new Error('--show-targets requires a module identifier');
  }
  const modules = await listModules();
  const match = modules.find((entry) => entry.id === moduleId);
  if (!match) {
    throw new Error(`Module not found: ${moduleId}`);
  }
  const moduleVersion = moduleVersionHint ?? match.latestVersion;
  if (!moduleVersion) {
    throw new Error(`Module ${moduleId} does not have a published version yet. Specify --module-version.`);
  }
  const artifact = await getModuleArtifact({ moduleId, moduleVersion });
  if (!artifact) {
    throw new Error(`Module artifact not found for ${moduleId}@${moduleVersion}`);
  }
  const targets = artifact.targets ?? [];
  if (targets.length === 0) {
    console.log(`Module ${moduleId}@${moduleVersion} has no registered targets.`);
    return;
  }
  console.log(`Targets for ${moduleId}@${moduleVersion}:`);
  for (const target of targets) {
    const displayName = target.displayName ?? target.name;
    console.log(`  - ${target.kind}/${target.name} (${displayName}) v${target.version}`);
  }
}

async function handleEnablement(moduleId: string | null, enabled: boolean): Promise<void> {
  if (!moduleId) {
    throw new Error(`${enabled ? '--enable' : '--disable'} requires a module identifier`);
  }
  const record = await setModuleEnablement({ moduleId, enabled });
  if (!record) {
    throw new Error(`Module not found: ${moduleId}`);
  }
  console.log(`Module ${moduleId} is now ${record.isEnabled ? 'enabled' : 'disabled'}.`);
}

async function handlePinJob(options: PinJobOptions): Promise<void> {
  if (!options.jobSlug) {
    throw new Error('--pin-job requires a job slug');
  }
  if (!options.moduleId) {
    throw new Error('--pin-job requires --module');
  }
  const moduleVersion = options.moduleVersion;
  if (!moduleVersion) {
    throw new Error('--pin-job requires --module-version');
  }
  if (!options.targetName) {
    throw new Error('--pin-job requires --target');
  }
  const targetVersion = options.targetVersion;
  const bindingRecord = await getModuleTarget({
    moduleId: options.moduleId,
    moduleVersion,
    targetName: options.targetName,
    targetVersion: targetVersion ?? null,
    allowDisabled: true
  });
  if (!bindingRecord) {
    throw new Error(
      `Module target not found: ${options.moduleId}@${moduleVersion}:${options.targetName}` +
        (targetVersion ? `@${targetVersion}` : '')
    );
  }
  const target = bindingRecord.target;
  const artifact = bindingRecord.artifact;

  const job = await getJobDefinitionBySlug(options.jobSlug);
  if (!job) {
    throw new Error(`Job definition not found: ${options.jobSlug}`);
  }

  const binding: ModuleTargetBinding = {
    moduleId: options.moduleId,
    moduleVersion,
    moduleArtifactId: artifact.id,
    targetName: target.name,
    targetVersion: target.version,
    targetFingerprint: target.fingerprint ?? null
  };

  await upsertJobDefinition({
    slug: job.slug,
    name: job.name,
    type: job.type,
    runtime: job.runtime,
    entryPoint: job.entryPoint,
    version: job.version,
    parametersSchema: job.parametersSchema,
    defaultParameters: job.defaultParameters,
    outputSchema: job.outputSchema,
    timeoutMs: job.timeoutMs,
    retryPolicy: job.retryPolicy ?? undefined,
    metadata: job.metadata ?? undefined,
    moduleBinding: binding
  });

  console.log(
    `Pinned job ${job.slug} to ${binding.moduleId}@${binding.moduleVersion} ` +
      `target ${binding.targetName}@${binding.targetVersion}`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error('[module:admin] Failed to parse arguments:', error instanceof Error ? error.message : error);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help || !options.mode) {
    printHelp();
    return;
  }

  if (options.databaseUrl) {
    process.env.DATABASE_URL = options.databaseUrl;
  }

  await ensureDatabase();

  switch (options.mode) {
    case 'list':
      await handleList();
      break;
    case 'show-targets':
      await handleShowTargets(options.moduleId ?? null, options.moduleVersion ?? null);
      break;
    case 'enable':
      await handleEnablement(options.moduleId ?? null, true);
      break;
    case 'disable':
      await handleEnablement(options.moduleId ?? null, false);
      break;
    case 'pin-job':
      await handlePinJob({
        jobSlug: options.jobSlug ?? null,
        moduleId: options.moduleId ?? null,
        moduleVersion: options.moduleVersion ?? null,
        targetName: options.targetName ?? null,
        targetVersion: options.targetVersion ?? null
      });
      break;
    default:
      throw new Error(`Unsupported command: ${options.mode}`);
  }
}

main()
  .catch((error) => {
    console.error('[module:admin] Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (err) {
      if (err) {
        console.warn('[module:admin] Failed to close DB pool', err);
      }
    }
  });
