import path from 'node:path';
import { Command } from 'commander';
import { generateModuleConfig, validateModuleConfig } from '../../lib/module';
import { deployModule } from '../../lib/moduleDeploy/deploy';

interface ConfigGenerateOptions {
  module?: string;
  definition?: string;
  out?: string;
  scratch?: string;
  overwrite?: boolean;
}

interface DoctorOptions {
  module?: string;
  definition?: string;
  config: string;
}

interface DeployOptions {
  module?: string;
  dist?: string;
  coreUrl?: string;
  coreToken?: string;
}

function resolveModulePath(candidate?: string): string {
  return candidate ? path.resolve(candidate) : process.cwd();
}

export function registerModuleCommands(program: Command): void {
  const moduleCommand = program
    .command('module')
    .description('Utilities for working with AppHub modules');

  moduleCommand
    .command('config generate')
    .description('Generate a configuration file seeded with module defaults and capability wiring')
    .option('-m, --module <path>', 'Path to the module workspace (defaults to CWD)')
    .option('--definition <path>', 'Path to the compiled module definition (module.js)')
    .option('-o, --out <path>', 'Output file or directory. When omitted, writes to <scratch>/config/<module>.json')
    .option('--scratch <path>', 'Scratch directory root used for default output placement')
    .option('--overwrite', 'Overwrite the destination if it already exists', false)
    .action(async (opts: ConfigGenerateOptions) => {
      const modulePath = resolveModulePath(opts.module);
      const result = await generateModuleConfig({
        modulePath,
        definitionPath: opts.definition,
        outputPath: opts.out,
        scratchDir: opts.scratch,
        overwrite: Boolean(opts.overwrite)
      });

      const capabilityKeys = Object.keys(result.config.capabilities);
      console.log(`Configuration written to ${result.outputPath}`);
      console.log(`Scratch directory: ${result.config.scratchDir}`);
      if (capabilityKeys.length > 0) {
        console.log(`Resolved capabilities: ${capabilityKeys.join(', ')}`);
      } else {
        console.log('Resolved capabilities: none');
      }
    });

  moduleCommand
    .command('doctor')
    .description('Validate module settings and secrets against the module definition')
    .requiredOption('-c, --config <path>', 'Path to the configuration file to validate')
    .option('-m, --module <path>', 'Path to the module workspace (defaults to CWD)')
    .option('--definition <path>', 'Path to the compiled module definition (module.js)')
    .action(async (opts: DoctorOptions) => {
      const modulePath = resolveModulePath(opts.module);
      const result = await validateModuleConfig({
        modulePath,
        configPath: opts.config,
        definitionPath: opts.definition
      });

      const capabilityKeys = Object.keys(result.resolvedCapabilities);
      console.log(
        `Configuration ${result.configPath} is valid for module ${result.metadata.name}@${result.metadata.version}`
      );
      if (capabilityKeys.length > 0) {
        console.log(`Capabilities: ${capabilityKeys.join(', ')}`);
      }
    });

  moduleCommand
    .command('deploy')
    .description('Invoke a module-supplied deployment entry point')
    .argument('[moduleArgs...]', 'Additional arguments forwarded to the deployment entry point')
    .option('-m, --module <path>', 'Path to the module workspace (defaults to CWD)')
    .option('--dist <path>', 'Path to the module dist directory (defaults to <module>/dist)')
    .option('--core-url <url>', 'Base URL for the AppHub core API', process.env.APPHUB_CORE_URL)
    .option('--core-token <token>', 'API token with permissions to administer the core API', process.env.APPHUB_CORE_TOKEN)
    .action(async (moduleArgs: string[] | undefined, opts: DeployOptions) => {
      void moduleArgs; // args are no longer forwarded but retained for compatibility

      const modulePath = resolveModulePath(opts.module);
      const distPath = path.resolve(modulePath, opts.dist ?? 'dist');
      const coreUrl = (opts.coreUrl ?? process.env.APPHUB_CORE_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
      const coreToken = opts.coreToken ?? process.env.APPHUB_CORE_TOKEN ?? '';
      if (!coreToken) {
        throw new Error('Core API token missing. Provide --core-token or set APPHUB_CORE_TOKEN.');
      }

      const logger = createLogger();
      const result = await deployModule({
        modulePath,
        distPath,
        coreUrl,
        coreToken,
        env: process.env,
        logger
      });

      logger.info('Module deployment complete', {
        modulePath,
        configPath: result.configPath ?? null,
        jobsProcessed: result.jobsProcessed,
        workflowsProcessed: result.workflowsProcessed,
        servicesProcessed: result.servicesProcessed,
        bucketsEnsured: result.bucketsEnsured,
        filestorePrefixesEnsured: result.filestorePrefixesEnsured
      });
    });
}

function createLogger() {
  return {
    info(message: string, meta?: Record<string, unknown>) {
      if (meta) {
        console.log(message, meta);
      } else {
        console.log(message);
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (meta) {
        console.warn(message, meta);
      } else {
        console.warn(message);
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (meta) {
        console.error(message, meta);
      } else {
        console.error(message);
      }
    },
    debug(message: string, meta?: Record<string, unknown>) {
      if (meta) {
        console.log(message, meta);
      } else {
        console.log(message);
      }
    }
  } as const;
}
