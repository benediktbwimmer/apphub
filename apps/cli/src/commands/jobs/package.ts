import path from 'node:path';
import { Command } from 'commander';
import { loadOrScaffoldBundle, packageBundle, getManifestDocumentationUrl } from '../../lib/bundle';
import { writeJsonFile } from '../../lib/json';

export function registerPackageCommand(jobs: Command): void {
  jobs
    .command('package [directory]')
    .description('Compile a job bundle and produce a signed tarball')
    .option('--config <path>', 'Relative path to bundle config (default: apphub.bundle.json)')
    .option('--slug <slug>', 'Override the bundle slug before packaging')
    .option('--version <version>', 'Override the manifest version before packaging')
    .option('--output-dir <path>', 'Directory for build artifacts (default: config.artifactDir)')
    .option('--filename <name>', 'Override tarball filename (default: <slug>-<version>.tgz)')
    .option('--skip-build', 'Reuse the existing dist directory instead of rebuilding')
    .option('--minify', 'Minify the compiled output')
    .option('--force', 'Overwrite existing tarball if present')
    .action(async (directory: string | undefined, options: Record<string, unknown>) => {
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      const configPath = typeof options.config === 'string' ? options.config : undefined;
      const slugOverride = typeof options.slug === 'string' ? options.slug : undefined;
      const versionOverride = typeof options.version === 'string' ? options.version : undefined;
      const outputDir = typeof options.outputDir === 'string' ? options.outputDir : undefined;
      const filename = typeof options.filename === 'string' ? options.filename : undefined;
      const skipBuild = Boolean(options.skipBuild);
      const minify = Boolean(options.minify);
      const force = Boolean(options.force);

      const { context, created } = await loadOrScaffoldBundle(targetDir, {
        configPath,
        slugOverride
      });

      if (created.length > 0) {
        console.log('Scaffolded bundle files:');
        for (const file of created) {
          console.log(`  • ${file}`);
        }
        console.log('Review the scaffolded files and update the manifest before packaging.');
      }

      if (versionOverride) {
        const trimmed = versionOverride.trim();
        if (!trimmed) {
          throw new Error('Version override cannot be empty.');
        }
        const originalVersion = context.manifest.version;
        if (originalVersion !== trimmed) {
          context.manifest.version = trimmed;
          await writeJsonFile(context.manifestPath, context.manifest);
          console.log(`Updated manifest version ${originalVersion} → ${trimmed}`);
        }
      }

      const result = await packageBundle(context, {
        outputDir,
        filename,
        skipBuild,
        minify,
        force
      });

      console.log('Bundle packaged successfully.');
      console.log(`  slug: ${result.config.slug}`);
      console.log(`  version: ${result.manifest.version}`);
      console.log(`  manifest: ${path.relative(targetDir, context.manifestPath)}`);
      console.log(`  artifact: ${path.relative(targetDir, result.tarballPath)}`);
      console.log(`  checksum (sha256): ${result.checksum}`);
      console.log(`
Upload the artifact with \
  apphub jobs publish ${path.relative(process.cwd(), targetDir) || '.'} --token <token>
`);
      console.log(`Manifest schema: ${getManifestDocumentationUrl()}`);
    });
}
