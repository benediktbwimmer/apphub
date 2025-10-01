import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { serializeModuleDefinition } from '@apphub/module-sdk';
import { ensureDatabase, closePool, publishModuleArtifact, upsertJobDefinition } from '../db';
import type { ModuleArtifactPublishResult } from '../db/modules';
import type { ModuleDefinition } from '@apphub/module-sdk';
import type { ModuleTargetBinding } from '../db/types';

interface CliOptions {
  moduleDir: string | null;
  workspace?: string | null;
  skipBuild?: boolean;
  databaseUrl?: string | null;
  artifactContentType?: string | null;
  registerJobs?: boolean;
  help?: boolean;
  unknown?: string[];
}

interface ModuleArtifactInfo {
  manifestPath: string;
  modulePath: string;
  checksum: string;
  size: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { moduleDir: null, unknown: [] };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    switch (arg) {
      case '--module':
      case '-m':
        options.moduleDir = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--workspace':
      case '-w':
        options.workspace = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--database-url':
        options.databaseUrl = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--artifact-content-type':
        options.artifactContentType = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--register-jobs':
        options.registerJobs = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        options.unknown?.push(arg);
        break;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: npm run module:publish -- --module <path> [options]\n\n` +
    `Options:\n` +
    `  --module, -m <path>          Path to the module workspace directory (required)\n` +
    `  --workspace, -w <name>       Optional npm workspace name to build via npm run build --workspace\n` +
    `  --skip-build                 Skip running the module build step\n` +
    `  --database-url <url>         Override DATABASE_URL when publishing\n` +
    `  --artifact-content-type <t>  Override artifact content type (default: application/javascript)\n` +
    `  --register-jobs              Upsert job definitions for module job targets after publish\n` +
    `  --help, -h                   Show this help message\n`);
}

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const spawned = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      env: process.env
    });
    spawned.on('error', reject);
    spawned.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function buildModule(options: { moduleDir: string; workspace?: string | null }): Promise<void> {
  if (options.workspace) {
    await runCommand('npm', ['run', 'build', '--workspace', options.workspace]);
    return;
  }
  await runCommand('npm', ['run', 'build'], { cwd: options.moduleDir });
}

async function loadModuleDefinition(modulePath: string): Promise<ModuleDefinition> {
  const moduleUrl = pathToFileURL(modulePath).href;
  const loaded = await import(moduleUrl);
  const definition: ModuleDefinition | undefined = loaded.default ?? loaded.module ?? null;
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Module definition not found in ${modulePath}`);
  }
  return definition as ModuleDefinition;
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`File not found: ${filePath}`);
  }
}

async function writeManifest(manifestPath: string, data: unknown): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(manifestPath, serialized, 'utf8');
}

async function computeArtifactInfo(modulePath: string, manifestPath: string): Promise<ModuleArtifactInfo> {
  const artifactData = await fs.readFile(modulePath);
  const stats = await fs.stat(modulePath);
  const checksum = createHash('sha256').update(artifactData).digest('hex');
  await ensureFileExists(manifestPath);
  return {
    manifestPath,
    modulePath,
    checksum,
    size: stats.size
  } satisfies ModuleArtifactInfo;
}

async function registerModuleJobs(result: ModuleArtifactPublishResult): Promise<void> {
  if (!result.targets || result.targets.length === 0) {
    console.log('[module:publish] No module targets to register');
    return;
  }

  const jobs = result.targets.filter((target) => target.kind === 'job');
  if (jobs.length === 0) {
    console.log('[module:publish] No job targets found; skipping job definition registration');
    return;
  }

  for (const target of jobs) {
    const binding: ModuleTargetBinding = {
      moduleId: result.module.id,
      moduleVersion: result.artifact.version,
      moduleArtifactId: result.artifact.id,
      targetName: target.name,
      targetVersion: target.version,
      targetFingerprint: target.fingerprint ?? null
    };

    const slug = `${result.module.id}.${target.name}`;
    const displayName = target.displayName ?? target.name;
    const defaultParameters = target.metadata?.parameters?.defaults ?? {};

    await upsertJobDefinition({
      slug,
      name: displayName,
      type: 'batch',
      runtime: 'module',
      entryPoint: `module://${result.module.id}/${target.name}`,
      version: 1,
      defaultParameters,
      parametersSchema: {},
      metadata: {
        module: {
          id: result.module.id,
          version: result.artifact.version,
          targetName: target.name,
          targetVersion: target.version,
          fingerprint: target.fingerprint ?? null
        }
      },
      moduleBinding: binding
    });

    console.log('[module:publish] Registered job definition', {
      slug,
      moduleId: binding.moduleId,
      targetName: binding.targetName,
      targetVersion: binding.targetVersion
    });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.moduleDir) {
    printHelp();
    throw new Error('Missing required --module argument');
  }

  const moduleDir = path.resolve(process.cwd(), options.moduleDir);
  const distDir = path.join(moduleDir, 'dist');
  const moduleJsPath = path.join(distDir, 'module.js');
  const manifestPath = path.join(distDir, 'module.json');

  const modulePkgRaw = await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8');
  const modulePkg = JSON.parse(modulePkgRaw) as { name?: string };

  if (!options.skipBuild) {
    await buildModule({ moduleDir, workspace: options.workspace ?? modulePkg.name ?? null });
  }

  await ensureFileExists(moduleJsPath);

  const moduleDefinition = await loadModuleDefinition(moduleJsPath);
  const manifest = serializeModuleDefinition(moduleDefinition);

  await writeManifest(manifestPath, manifest);

  const artifactInfo = await computeArtifactInfo(moduleJsPath, manifestPath);

  if (options.databaseUrl) {
    process.env.DATABASE_URL = options.databaseUrl;
  }

  await ensureDatabase();

  const artifactRecord = await publishModuleArtifact({
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    displayName: manifest.metadata.displayName ?? null,
    description: manifest.metadata.description ?? null,
    keywords: manifest.metadata.keywords ?? [],
    manifest,
    artifactPath: artifactInfo.modulePath,
    artifactChecksum: artifactInfo.checksum,
    artifactStorage: 'filesystem',
    artifactContentType: options.artifactContentType ?? 'application/javascript',
    artifactSize: artifactInfo.size
  });

  console.log('\nModule publication complete:');
  console.log(`  Module:   ${artifactRecord.module.id}@${artifactRecord.artifact.version}`);
  console.log(`  Targets:  ${artifactRecord.targets.length}`);
  console.log(`  Manifest: ${path.relative(process.cwd(), artifactInfo.manifestPath)}`);
  console.log(`  Bundle:   ${path.relative(process.cwd(), artifactInfo.modulePath)} (sha256 ${artifactInfo.checksum})`);

  if (options.registerJobs) {
    await registerModuleJobs(artifactRecord);
  }
}

main()
  .catch(async (error) => {
    console.error('[module:publish] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (err) {
      if (err) {
        console.warn('[module:publish] Failed to close DB pool', err);
      }
    }
  });
