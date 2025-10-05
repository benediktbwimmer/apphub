import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { generate, HttpClient, Indent } from 'openapi-typescript-codegen';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const services = [
  { name: 'core', spec: 'services/core/openapi.json', output: 'packages/shared/src/api/core', clientName: 'CoreClient' },
  { name: 'metastore', spec: 'services/metastore/openapi.json', output: 'packages/shared/src/api/metastore', clientName: 'MetastoreClient' },
  { name: 'filestore', spec: 'services/filestore/openapi.json', output: 'packages/shared/src/api/filestore', clientName: 'FilestoreClient' },
  { name: 'timestore', spec: 'services/timestore/openapi.json', output: 'packages/shared/src/api/timestore', clientName: 'TimestoreClient' }
];

async function ensureSpecExists(specPath, serviceName) {
  try {
    await access(specPath);
  } catch (error) {
    throw new Error(`OpenAPI spec not found for ${serviceName}: ${specPath}`);
  }
}

function rewriteCoreRefs(document) {
  const stack = [document];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('https://core.apphub/schemas/')) {
        current[key] = `#/components/schemas/${value.slice('https://core.apphub/schemas/'.length).replace(/\.json$/i, '')}`;
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
}

function normalizeWildcardPaths(document) {
  const paths = document?.paths;
  if (!paths) {
    return;
  }

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!rawPath.includes('{*}')) {
      continue;
    }
    const normalizedPath = rawPath.replace('{*}', '{wildcard}');
    if (!paths[normalizedPath]) {
      paths[normalizedPath] = pathItem;
    }
    delete paths[rawPath];

    const maybeParameters = [];
    if (Array.isArray(pathItem?.parameters)) {
      maybeParameters.push(pathItem.parameters);
    }
    for (const method of ['get', 'put', 'post', 'patch', 'delete', 'options', 'head']) {
      const operation = pathItem?.[method];
      if (Array.isArray(operation?.parameters)) {
        maybeParameters.push(operation.parameters);
      }
    }

    for (const params of maybeParameters) {
      for (const param of params) {
        if (param && typeof param === 'object' && param.name === '*') {
          param.name = 'wildcard';
        }
      }
    }
  }
}

async function loadSpec(name, specPath) {
  const raw = await readFile(specPath, 'utf8');
  const document = JSON.parse(raw);
  if (name === 'core') {
    rewriteCoreRefs(document);
    normalizeWildcardPaths(document);
  }
  return document;
}

async function generateClient({ name, spec, output, clientName }) {
  const inputPath = path.resolve(rootDir, spec);
  const outputPath = path.resolve(rootDir, output);

  await ensureSpecExists(inputPath, name);

  await rm(outputPath, { recursive: true, force: true });
  await mkdir(outputPath, { recursive: true });

  const document = await loadSpec(name, inputPath);

  await generate({
    input: document,
    output: outputPath,
    clientName,
    httpClient: HttpClient.FETCH,
    useOptions: true,
    useUnionTypes: true,
    exportCore: true,
    exportServices: true,
    exportModels: true,
    exportSchemas: true,
    indent: Indent.SPACE_2
  });
}

async function main() {
  for (const service of services) {
    // eslint-disable-next-line no-console
    console.log(`Generating ${service.name} client...`);
    await generateClient(service);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
