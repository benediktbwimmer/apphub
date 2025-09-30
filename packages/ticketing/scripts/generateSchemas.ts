import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

import {
  buildNewTicketJsonSchema,
  buildTicketDependencyGraphJsonSchema,
  buildTicketIndexJsonSchema,
  buildTicketJsonSchema,
  buildTicketUpdateJsonSchema
} from '../src/schema';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaDir = path.resolve(__dirname, '../schemas');

const SCHEMAS: Record<string, unknown> = {
  'ticket.json': buildTicketJsonSchema(),
  'ticket.new.json': buildNewTicketJsonSchema(),
  'ticket.update.json': buildTicketUpdateJsonSchema(),
  'ticket.index.json': buildTicketIndexJsonSchema(),
  'ticket.dependencies.json': buildTicketDependencyGraphJsonSchema()
};

const writeSchemas = async () => {
  await mkdir(schemaDir, { recursive: true });
  await Promise.all(
    Object.entries(SCHEMAS).map(async ([filename, schema]) => {
      const target = path.join(schemaDir, filename);
      await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    })
  );
};

writeSchemas().catch((error) => {
  console.error('Failed to generate ticketing schemas');
  console.error(error);
  process.exitCode = 1;
});
