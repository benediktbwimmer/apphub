import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { exampleConfigDescriptorSchema } from '../src/serviceConfigLoader';

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const outputPath = path.join(repoRoot, 'docs/schemas/example-config.schema.json');

  const jsonSchema = zodToJsonSchema(exampleConfigDescriptorSchema, 'ModuleConfigDescriptor', {
    target: 'jsonSchema7'
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(jsonSchema, null, 2)}\n`, 'utf8');
  console.log(`Wrote module config schema to ${path.relative(repoRoot, outputPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
