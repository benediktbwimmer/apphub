import process from 'node:process';
import path from 'node:path';
import { backfillServiceRegistry, formatBackfillResult } from '../serviceRegistryBackfill';

function printUsage(): void {
  console.log(`Usage: backfill-service-registry [options]\n\n`);
  console.log('Options:');
  console.log('  --path <dir>         Add a service manifest module directory (default: modules/environmental-observatory/resources)');
  console.log('  --module <id>        Override the expected module identifier');
  console.log('  --config <path>      Provide an explicit service config path for the last --path');
  console.log('  --var KEY=VALUE      Provide a placeholder override (can be specified multiple times)');
  console.log('  --no-bootstrap       Allow module bootstrap actions to run');
  console.log('  --help               Show this message');
}

type ParsedTarget = {
  path: string;
  moduleId?: string;
  configPath?: string;
  variables: Record<string, string>;
};

type ParsedArgs = {
  targets: ParsedTarget[];
  skipBootstrap: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const targets: ParsedTarget[] = [];
  let currentTarget: ParsedTarget | null = null;
  let skipBootstrap = true;

  const ensureTarget = () => {
    if (!currentTarget) {
      currentTarget = { path: '', variables: {} };
      targets.push(currentTarget);
    }
    return currentTarget;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--no-bootstrap') {
      skipBootstrap = false;
      continue;
    }

    if (arg === '--path') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--path requires a value');
      }
      i += 1;
      currentTarget = { path: value, variables: {} };
      targets.push(currentTarget);
      continue;
    }

    if (arg.startsWith('--path=')) {
      const value = arg.slice('--path='.length);
      if (!value) {
        throw new Error('--path requires a value');
      }
      currentTarget = { path: value, variables: {} };
      targets.push(currentTarget);
      continue;
    }

    if (arg === '--module') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--module requires a value');
      }
      i += 1;
      ensureTarget().moduleId = value;
      continue;
    }

    if (arg.startsWith('--module=')) {
      const value = arg.slice('--module='.length);
      if (!value) {
        throw new Error('--module requires a value');
      }
      ensureTarget().moduleId = value;
      continue;
    }

    if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--config requires a value');
      }
      i += 1;
      ensureTarget().configPath = value;
      continue;
    }

    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (!value) {
        throw new Error('--config requires a value');
      }
      ensureTarget().configPath = value;
      continue;
    }

    if (arg === '--var' || arg === '-v') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--var requires KEY=VALUE');
      }
      i += 1;
      const [key, ...rest] = value.split('=');
      if (!key || rest.length === 0) {
        throw new Error('--var requires KEY=VALUE');
      }
      ensureTarget().variables[key] = rest.join('=');
      continue;
    }

    if (arg.startsWith('--var=')) {
      const value = arg.slice('--var='.length);
      const [key, ...rest] = value.split('=');
      if (!key || rest.length === 0) {
        throw new Error('--var requires KEY=VALUE');
      }
      ensureTarget().variables[key] = rest.join('=');
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (targets.length === 0) {
    targets.push({
      path: 'modules/environmental-observatory/resources',
      moduleId: 'environmental-observatory',
      variables: {}
    });
  }

  // Resolve relative config paths with respect to the provided directories for convenience.
  for (const target of targets) {
    if (target.configPath && !path.isAbsolute(target.configPath)) {
      const baseDir = path.isAbsolute(target.path)
        ? target.path
        : path.resolve(process.cwd(), target.path);
      target.configPath = path.resolve(baseDir, target.configPath);
    }
  }

  return { targets, skipBootstrap };
}

async function main() {
  try {
    const { targets, skipBootstrap } = parseArgs(process.argv.slice(2));
    const results = await backfillServiceRegistry({
      targets,
      skipBootstrap
    });

    if (results.length === 0) {
      console.log('No manifests imported.');
      return;
    }

    for (const result of results) {
      console.log(formatBackfillResult(result));
    }
  } catch (err) {
    console.error('[backfill] failed to backfill service registry');
    if (err instanceof Error) {
      console.error(`Reason: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

void main();
