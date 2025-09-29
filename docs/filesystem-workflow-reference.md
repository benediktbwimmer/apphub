# Filesystem Summary Workflow Reference

This guide captures the repeatable steps required to make the filesystem summary workflow available when the catalog service is running inside the `apphub` container. It covers publishing the filesystem job bundles and registering the workflow. Database cleanup steps are intentionally excluded.

## Prerequisites
- The `apphub` container is running (see the `docker run ... apphub` invocation).
- You can exec into the container: `docker exec -it apphub bash`.
- An operator token with `job-bundles:write`, `jobs:write`, and `workflows:write` scopes is available. In the default config, `example-operator-token-123` works.
- Node.js and the catalog service code are available inside the container at `/app/services/catalog` (already satisfied by the runtime image).

## 1. Publish the Filesystem Job Bundles
The filesystem read/write jobs need to be published to the local bundle registry before workflows can reference them.

1. Create a script that packages and publishes both bundles via the in-process registry service. From the host, run:
   ```bash
   cat <<'NODE' | docker exec -i apphub bash -lc 'cd /app/services/catalog && node -'
   const { publishBundleVersion } = require('./dist/jobs/registryService.js');
   const { closePool } = require('./dist/db/index.js');

   const bundles = [
     {
       slug: 'fs-read-file',
       version: '1.0.0',
       manifest: {
         name: 'Filesystem Read File',
         version: '1.0.0',
         entry: 'index.js',
         description: 'Reads a file from the host filesystem and returns its contents.',
         capabilities: ['fs']
       },
       source: `"use strict";
const path = require('path');
const fsPromises = require('fs/promises');
const fsConstants = require('fs').constants;
const { Buffer } = require('buffer');
const DEFAULT_ENCODING = 'utf8';
const ENCODING_ALIASES = { utf8: 'utf8', 'utf-8': 'utf8', utf16le: 'utf16le', 'utf-16le': 'utf16le', latin1: 'latin1', ascii: 'ascii', base64: 'base64', hex: 'hex' };
function normalizeEncoding(value, fallback = DEFAULT_ENCODING) { if (typeof value !== 'string') return fallback; const candidate = value.trim().toLowerCase(); return candidate ? (ENCODING_ALIASES[candidate] || fallback) : fallback; }
function ensureAbsolutePath(value, fieldName) { if (typeof value !== 'string') throw new Error(`${fieldName} parameter is required`); const trimmed = value.trim(); if (!trimmed) throw new Error(`${fieldName} parameter is required`); if (!path.isAbsolute(trimmed)) throw new Error(`${fieldName} must be an absolute path`); return path.resolve(trimmed); }
function buildCandidatePaths(normalizedHostPath) { return { containerPath: normalizedHostPath, candidates: [normalizedHostPath] }; }
function toIsoDate(date) { return date instanceof Date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null; }
async function resolveReadableFile(hostPath, fieldName) { const normalized = ensureAbsolutePath(hostPath, fieldName); const { containerPath, candidates } = buildCandidatePaths(normalized); const errors = []; for (const candidate of candidates) {
    try { const stats = await fsPromises.stat(candidate); if (!stats.isFile()) { errors.push(`${candidate} is not a regular file`); continue; } await fsPromises.access(candidate, fsConstants.R_OK); return { hostPath: normalized, containerPath, effectivePath: candidate, stats }; } catch (err) { errors.push(err && err.message ? err.message : String(err)); }
  }
  const suffix = errors.length ? `: ${errors.join('; ')}` : '';
  throw new Error(`Unable to read file at ${hostPath}${suffix}`);
}
exports.handler = async function handler(context) {
  const params = context?.parameters ?? {};
  const hostPath = ensureAbsolutePath(params.hostPath, 'hostPath');
  const encoding = normalizeEncoding(params.encoding);
  context.logger('Reading file from host filesystem', { hostPath });
  const resolved = await resolveReadableFile(hostPath, 'hostPath');
  const content = await fsPromises.readFile(resolved.effectivePath, { encoding });
  const byteLength = Buffer.byteLength(content, encoding);
  const directory = path.dirname(resolved.hostPath);
  const fileName = path.basename(resolved.hostPath);
  await context.update({ metrics: { bytesRead: byteLength, hostPath: resolved.hostPath } });
  return {
    status: 'succeeded',
    result: {
      hostPath: resolved.hostPath,
      containerPath: resolved.containerPath,
      resolvedPath: resolved.effectivePath,
      encoding,
      size: resolved.stats.size,
      byteLength,
      modifiedAt: toIsoDate(resolved.stats.mtime),
      createdAt: toIsoDate(resolved.stats.birthtime) || toIsoDate(resolved.stats.ctime),
      directory,
      fileName,
      content
    }
  };
};`
     },
     {
       slug: 'fs-write-file',
       version: '1.0.0',
       manifest: {
         name: 'Filesystem Write File',
         version: '1.0.0',
         entry: 'index.js',
         description: 'Writes summary content next to the source file.',
         capabilities: ['fs']
       },
       source: `"use strict";
const path = require('path');
const fsPromises = require('fs/promises');
const fsConstants = require('fs').constants;
const { Buffer } = require('buffer');
const DEFAULT_ENCODING = 'utf8';
const ENCODING_ALIASES = { utf8: 'utf8', 'utf-8': 'utf8', utf16le: 'utf16le', 'utf-16le': 'utf16le', latin1: 'latin1', ascii: 'ascii', base64: 'base64', hex: 'hex' };
function normalizeEncoding(value, fallback = DEFAULT_ENCODING) { if (typeof value !== 'string') return fallback; const candidate = value.trim().toLowerCase(); return candidate ? (ENCODING_ALIASES[candidate] || fallback) : fallback; }
function ensureAbsolutePath(value, fieldName) { if (typeof value !== 'string') throw new Error(`${fieldName} parameter is required`); const trimmed = value.trim(); if (!trimmed) throw new Error(`${fieldName} parameter is required`); if (!path.isAbsolute(trimmed)) throw new Error(`${fieldName} must be an absolute path`); return path.resolve(trimmed); }
function buildCandidatePaths(normalizedHostPath) { return { containerPath: normalizedHostPath, candidates: [normalizedHostPath] }; }
async function resolveWritablePath(targetHostPath, fieldName) { const normalized = ensureAbsolutePath(targetHostPath, fieldName); const { containerPath, candidates } = buildCandidatePaths(normalized); const errors = []; for (const candidate of candidates) {
    try {
      const parent = path.dirname(candidate);
      await fsPromises.mkdir(parent, { recursive: true });
      await fsPromises.access(parent, fsConstants.W_OK);
      return { hostPath: normalized, containerPath, effectivePath: candidate };
    } catch (err) {
      errors.push(err && err.message ? err.message : String(err));
    }
  }
  const suffix = errors.length ? `: ${errors.join('; ')}` : '';
  throw new Error(`Unable to resolve writable path for ${targetHostPath}${suffix}`);
}
exports.handler = async function handler(context) {
  const params = context?.parameters ?? {};
  const sourcePath = ensureAbsolutePath(params.sourcePath, 'sourcePath');
  const encoding = normalizeEncoding(params.encoding);
  const rawOutputPath = typeof params.outputPath === 'string' ? params.outputPath.trim() : '';
  const explicitOutputPath = rawOutputPath ? ensureAbsolutePath(rawOutputPath, 'outputPath') : null;
  const rawFilename = typeof params.outputFilename === 'string' ? params.outputFilename.trim() : '';
  if (rawFilename && rawFilename.includes(path.sep)) {
    throw new Error('outputFilename must not include path separators');
  }
  const content = params.content;
  if (typeof content !== 'string') {
    throw new Error('content parameter is required and must be a string');
  }
  const overwrite = typeof params.overwrite === 'boolean' ? params.overwrite : true;
  const targetHostPath = explicitOutputPath ? explicitOutputPath : path.join(path.dirname(sourcePath), rawFilename || `${path.basename(sourcePath)}.summary.txt`);
  context.logger('Writing summary file to host filesystem', { sourcePath, targetHostPath, overwrite });
  const resolved = await resolveWritablePath(targetHostPath, 'targetPath');
  let existed = false;
  try {
    await fsPromises.access(resolved.effectivePath, fsConstants.F_OK);
    existed = true;
  } catch {
    existed = false;
  }
  if (existed && !overwrite) {
    throw new Error(`File already exists at ${targetHostPath} and overwrite is disabled`);
  }
  await fsPromises.writeFile(resolved.effectivePath, content, { encoding });
  const stats = await fsPromises.stat(resolved.effectivePath);
  const bytesWritten = Buffer.byteLength(content, encoding);
  const directory = path.dirname(resolved.hostPath);
  const fileName = path.basename(resolved.hostPath);
  await context.update({ metrics: { bytesWritten, hostPath: resolved.hostPath, overwrite: existed } });
  return {
    status: 'succeeded',
    result: {
      sourcePath,
      hostPath: resolved.hostPath,
      containerPath: resolved.containerPath,
      resolvedPath: resolved.effectivePath,
      encoding,
      bytesWritten,
      size: stats.size,
      modifiedAt: stats.mtime instanceof Date ? stats.mtime.toISOString() : null,
      createdAt: stats.birthtime instanceof Date ? stats.birthtime.toISOString() : null,
      overwroteExisting: existed,
      directory,
      fileName
    }
  };
};`
     }
   ];

   const tar = require('tar');
   const os = require('os');
   const fs = require('fs');
   const path = require('path');
   const crypto = require('crypto');

   async function createTarball(bundle) {
     const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-${bundle.slug}-`));
     const manifestPath = path.join(tmpDir, 'manifest.json');
     const indexPath = path.join(tmpDir, 'index.js');
     fs.writeFileSync(manifestPath, JSON.stringify(bundle.manifest, null, 2), 'utf8');
     fs.writeFileSync(indexPath, bundle.source, 'utf8');
     const tarPath = path.join(tmpDir, `${bundle.slug}-${bundle.version}.tgz`);
     await tar.create({ gzip: true, cwd: tmpDir, file: tarPath }, ['manifest.json', 'index.js']);
     const data = fs.readFileSync(tarPath);
     return { data, checksum: crypto.createHash('sha256').update(data).digest('hex'), filename: path.basename(tarPath) };
   }

   (async () => {
     const actor = { subject: 'workflow-bootstrap', kind: 'service' };
     try {
       for (const bundle of bundles) {
         console.log(`Publishing ${bundle.slug}@${bundle.version}...`);
         const artifact = await createTarball(bundle);
         await publishBundleVersion({
           slug: bundle.slug,
           version: bundle.version,
           manifest: bundle.manifest,
           capabilityFlags: bundle.manifest.capabilities,
           artifact: {
             data: artifact.data,
             filename: artifact.filename,
             contentType: 'application/gzip',
             checksum: artifact.checksum
           }
         }, actor);
         console.log(`Published ${bundle.slug}@${bundle.version}`);
       }
     } catch (err) {
       console.error('Failed to publish bundles', err);
       process.exitCode = 1;
     } finally {
       await closePool();
     }
   })();
   NODE
   ```

2. Verify the bundles are registered:
   ```bash
   docker exec apphub psql -U apphub -d apphub -c "SELECT slug, latest_version FROM job_bundles;"
   docker exec apphub ls /app/services/catalog/data/job-bundles
   ```

## 2. Register the Filesystem Summary Workflow
With the bundles published, register the workflow that stitches the filesystem jobs and the AI connector together.

1. Save the workflow definition locally (or construct the payload directly). Example payload:
   ```json
   {
     "slug": "filesystem-file-summary",
     "name": "Filesystem File Summarizer",
     "description": "Reads a host file, summarizes the content via the AI connector, and writes a summary next to the original file.",
     "version": 1,
     "parametersSchema": {
       "type": "object",
       "required": ["filepath"],
       "properties": {
         "filepath": {
           "type": "string",
           "title": "Source File Path",
           "description": "Absolute path to the host file that should be summarized.",
           "minLength": 1
         }
       }
     },
     "steps": [
       {
         "id": "read-source",
         "name": "Read Source File",
         "type": "job",
         "jobSlug": "fs-read-file",
         "storeResultAs": "sourceFile",
         "parameters": {
           "hostPath": "{{ parameters.filepath }}",
           "encoding": "utf8"
         }
       },
       {
         "id": "summarize",
         "name": "Summarize Content",
         "type": "service",
         "serviceSlug": "ai-connector",
         "dependsOn": ["read-source"],
         "timeoutMs": 120000,
         "captureResponse": true,
         "storeResponseAs": "summaryResponse",
         "request": {
           "method": "POST",
           "path": "/chat/completions",
           "headers": {
             "content-type": "application/json"
           },
           "body": {
             "provider": "ollama",
             "model": "gpt-oss:20b",
             "messages": [
               {
                 "role": "system",
                 "content": "You are an assistant that writes concise, high-signal summaries for technical documents."
               },
               {
                 "role": "user",
                 "content": "Summarize the following file:\n\n{{ shared.sourceFile.content }}"
               }
             ]
           }
         }
       },
       {
         "id": "write-summary",
         "name": "Write Summary File",
         "type": "job",
         "jobSlug": "fs-write-file",
         "dependsOn": ["read-source", "summarize"],
         "storeResultAs": "summaryFile",
         "parameters": {
           "sourcePath": "{{ parameters.filepath }}",
           "encoding": "utf8",
           "overwrite": true,
           "outputFilename": "{{ shared.sourceFile.fileName }}.summary.txt",
           "content": "Summary generated via gpt-oss:20b:\n\n{{ shared.summaryResponse.content }}"
         }
       }
     ]
   }
   ```

2. POST the workflow definition to the catalog API:
   ```bash
   curl -sS -X POST http://127.0.0.1:4000/workflows \
     -H "Authorization: Bearer example-operator-token-123" \
     -H "Content-Type: application/json" \
     --data @workflow_definition.json
   ```

3. Verify registration:
   ```bash
   curl -sS http://127.0.0.1:4000/workflows/filesystem-file-summary
   docker exec apphub psql -U apphub -d apphub -c "SELECT slug, name FROM workflow_definitions;"
   ```

## 3. Triggering the Workflow (For Validation)
To confirm everything works end-to-end, trigger a manual run after the workflow is registered:
```bash
curl -sS -X POST http://127.0.0.1:4000/workflows/filesystem-file-summary/run \
  -H "Authorization: Bearer example-operator-token-123" \
  -H "Content-Type: application/json" \
  --data '{"parameters":{"filepath":"/absolute/path/to/file.txt"}}'
```
Inspect the resulting runs and ensure the summary file is created next to the original path. These commands mirror the operations that need to be surfaced by any future UI implementation.
