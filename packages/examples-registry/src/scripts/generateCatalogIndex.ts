import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildExamplesCatalogIndex } from '../catalogIndex';

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function main(): Promise<void> {
  const index = buildExamplesCatalogIndex();
  const sorted = {
    jobs: sortRecord(index.jobs),
    workflows: sortRecord(index.workflows)
  };

  const repoRelativePath = '../../examples/catalog-index.json';
  const outputPath = path.resolve(process.cwd(), repoRelativePath);
  await fs.writeFile(outputPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`Wrote examples catalog index to ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error('[examples-registry] Failed to build catalog index:', error);
  process.exitCode = 1;
});
