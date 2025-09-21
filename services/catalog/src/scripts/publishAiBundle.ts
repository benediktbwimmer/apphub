import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import tar from 'tar';
import { publishBundleVersion } from '../jobs/registryService';
import { closePool } from '../db/index';

const DEFAULT_SLUG = 'ai-orchestrator';
const DEFAULT_VERSION = '0.1.0';
const HANDLER_TEMPLATE_PATH = path.join(__dirname, 'templates', 'aiOrchestratorHandler.js');

async function createTarball(slug: string, version: string): Promise<{ data: Buffer; filename: string; checksum: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${slug}-bundle-`));
  const manifest = {
    name: 'AI Orchestrator',
    version,
    entry: 'index.js',
    description: 'Generates workflow or job definitions using the Codex CLI.',
    capabilities: ['fs', 'network', 'process'],
    metadata: {
      docs: 'docs/ai-builder.md'
    }
  };

  const manifestPath = path.join(tempDir, 'manifest.json');
  const indexPath = path.join(tempDir, 'index.js');
  const tarPath = path.join(tempDir, `${slug}-${version}.tgz`);

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const handlerSource = await fs.readFile(HANDLER_TEMPLATE_PATH, 'utf8');
  await fs.writeFile(indexPath, handlerSource, 'utf8');

  await tar.create({ cwd: tempDir, gzip: true, file: tarPath }, ['manifest.json', 'index.js']);
  const data = await fs.readFile(tarPath);
  const checksum = crypto.createHash('sha256').update(data).digest('hex');
  await fs.rm(tempDir, { recursive: true, force: true });
  return {
    data,
    filename: path.basename(tarPath),
    checksum
  };
}

async function main(): Promise<void> {
  const slug = process.env.APPHUB_AI_BUNDLE_SLUG?.trim() || DEFAULT_SLUG;
  const version = process.env.APPHUB_AI_BUNDLE_VERSION?.trim() || DEFAULT_VERSION;

  const artifact = await createTarball(slug, version);

  await publishBundleVersion(
    {
      slug,
      version,
      manifest: {
        name: 'AI Orchestrator',
        version,
        entry: 'index.js',
        description: 'Generates workflow or job definitions using the Codex CLI.',
        capabilities: ['fs', 'network', 'process'],
        metadata: {
          docs: 'docs/ai-builder.md'
        }
      },
      description: 'AI-assisted workflow/job generation handler powered by the Codex CLI.',
      displayName: 'AI Orchestrator',
      capabilityFlags: ['codex', 'ai'],
      artifact: {
        data: artifact.data,
        filename: artifact.filename,
        contentType: 'application/gzip',
        checksum: artifact.checksum
      }
    },
    { subject: 'ai-orchestrator-publisher', kind: 'service' }
  );

  console.log(`Published job bundle ${slug}@${version}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
