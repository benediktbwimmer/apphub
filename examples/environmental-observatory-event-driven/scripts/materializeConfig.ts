import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createEventDrivenObservatoryConfig } from '@apphub/examples-registry';

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const { config, outputPath } = createEventDrivenObservatoryConfig({
    repoRoot,
    variables: process.env
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Observatory config written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
