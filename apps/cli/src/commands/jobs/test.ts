import path from 'node:path';
import { Command } from 'commander';
import { loadOrScaffoldBundle, buildBundle } from '../../lib/bundle';
import { writeJsonFile } from '../../lib/json';
import {
  executeBundle,
  loadInlineParameters,
  loadSampleParameters,
  readParametersFromFile
} from '../../lib/harness';
import type { JsonValue } from '../../types';

export function registerTestCommand(jobs: Command): void {
  jobs
    .command('test [directory]')
    .description('Run the job handler locally with sample inputs')
    .option('--config <path>', 'Relative path to bundle config (default: apphub.bundle.json)')
    .option('--slug <slug>', 'Override bundle slug before running')
    .option('--version <version>', 'Override manifest version before running')
    .option('--input <path>', 'Path to a JSON file with parameters')
    .option('--input-json <json>', 'Inline JSON parameters')
    .option('--skip-build', 'Use the existing dist output instead of rebuilding')
    .action(async (directory: string | undefined, options: Record<string, unknown>) => {
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      const configPath = typeof options.config === 'string' ? options.config : undefined;
      const slugOverride = typeof options.slug === 'string' ? options.slug : undefined;
      const versionOverride = typeof options.version === 'string' ? options.version : undefined;
      const inputPath = typeof options.input === 'string' ? options.input : undefined;
      const inputJson = typeof options.inputJson === 'string' ? options.inputJson : undefined;
      const skipBuild = Boolean(options.skipBuild);

      const { context, created } = await loadOrScaffoldBundle(targetDir, {
        configPath,
        slugOverride
      });

      if (created.length > 0) {
        console.log('Scaffolded bundle files:');
        for (const file of created) {
          console.log(`  • ${file}`);
        }
        console.log('Review the scaffolded files and update the manifest before running tests.');
      }

      if (versionOverride) {
        const trimmed = versionOverride.trim();
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

      await buildBundle(context, { skipBuild });

      let parameters: JsonValue;
      const inline = await loadInlineParameters(inputJson);
      if (inline !== undefined) {
        parameters = inline;
      } else if (inputPath) {
        parameters = await readParametersFromFile(path.resolve(targetDir, inputPath));
      } else {
        parameters = await loadSampleParameters(context);
      }

      const execution = await executeBundle(context, parameters);
      console.log('Job execution complete.');
      console.log(`  status: ${execution.result.status ?? 'succeeded'}`);
      if (execution.result.errorMessage) {
        console.log(`  error: ${execution.result.errorMessage}`);
      }
      if (execution.result.result !== undefined) {
        console.log(`  result: ${JSON.stringify(execution.result.result, null, 2)}`);
      }
      if (execution.result.metrics !== undefined) {
        console.log(`  metrics: ${JSON.stringify(execution.result.metrics, null, 2)}`);
      }
      if (execution.result.context !== undefined) {
        console.log(`  context: ${JSON.stringify(execution.result.context, null, 2)}`);
      }
      console.log(`  duration: ${execution.durationMs}ms`);
    });
}
