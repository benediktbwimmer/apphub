# Job Bundle Tooling

AppHub job bundles are portable archives that ship a manifest, compiled handler code, and any assets the job requires at runtime. The developer CLI (`apphub`) streamlines scaffolding, validation, packaging, testing, and publishing these bundles to the job registry introduced in ticket 006.

## CLI Overview

| Command | Description |
| --- | --- |
| `apphub jobs package` | Scaffold a bundle (if needed), compile TypeScript, and emit a signed tarball. |
| `apphub jobs test` | Execute the bundle locally with sample inputs to validate handler behaviour. |
| `apphub jobs publish` | Upload the tarball and manifest to the registry with capability flags and checksum verification. |

Run the CLI from the repository root or inside a bundle directory:

```bash
npx tsx apps/cli/src/index.ts jobs package my-bundle
```

Add `--help` to any command for option details.

## Scaffolded Layout

The first packaging run generates the following files (paths relative to the bundle root):

```
apphub.bundle.json   # CLI configuration (slug, entry points, artifacts, globs)
manifest.json        # Bundle manifest consumed by the registry
src/index.ts         # Job handler entry point (TypeScript)
tests/sample-input.json
tests/handler.test.ts
```

### `apphub.bundle.json`

```json
{
  "slug": "example-job",
  "entry": "src/index.ts",
  "outDir": "dist",
  "manifestPath": "manifest.json",
  "artifactDir": "artifacts",
  "files": ["manifest.json", "dist/**/*"],
  "tests": {
    "sampleInputPath": "tests/sample-input.json"
  }
}
```

- `slug` becomes the bundle identifier used when publishing (`slug@version`).
- `entry` points to the TypeScript source that esbuild compiles into `manifest.entry`.
- `files` controls which paths land in the tarball (globs resolved relative to the bundle root).

### `manifest.json`

Manifest schema matches the registry contract:

```json
{
  "name": "Example Job",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "description": "Summarises inputs",
  "capabilities": ["fs"],
  "metadata": {
    "docs": "docs/job-bundles.md"
  }
}
```

- `entry` references the compiled JavaScript file inside the tarball.
- `capabilities` advertises which runtime capabilities the handler requires (`fs`, `network`, etc.). The CLI merges these with any additional `--capability` flags during publish.
- `metadata` is arbitrary JSON recorded alongside the bundle version.

The CLI validates manifests with JSON Schema (see `apps/cli/src/schemas/job-bundle-manifest.schema.json`). Packaging fails fast with descriptive errors when required fields are missing or empty.

### Handler Contract

`src/index.ts` must export either a default async function or a named `handler` that matches the AppHub job runtime signature:

```ts
export async function handler(context: JobRunContext): Promise<JobResult> {
  context.logger('Processing payload', context.parameters);
  await context.update({ metrics: { processed: true } });
  return {
    status: 'succeeded',
    result: {
      echoed: context.parameters
    }
  };
}
```

The CLI's local harness injects a lightweight `JobRunContext` stub with `definition`, `run`, `parameters`, `update`, `logger`, and `resolveSecret`. Use `context.update` to simulate progress reporting and `context.logger` for structured logs that surface in test output.

## Packaging Workflow

```
apphub jobs package . --force
```

Steps performed:

1. Scaffold missing files (`apphub.bundle.json`, `manifest.json`, entry, tests`).
2. Validate the manifest (JSON Schema).
3. Compile TypeScript entry via esbuild (`dist/index.js`).
4. Assemble a deterministic tarball containing `manifest.json` and files matched by the config globs.
5. Compute a SHA-256 checksum, writing `<artifact>.sha256` next to the tarball.

Key flags:

- `--slug <value>` override bundle slug (persisted back to config).
- `--version <value>` update `manifest.version` before building.
- `--skip-build` reuse an existing `dist/` output (fails if files are absent).
- `--output-dir <path>` and `--filename <name>` customise artifact placement.
- `--minify` enable esbuild minification.
- `--force` overwrite an existing tarball.

## Local Testing

```
apphub jobs test . \
  --input-json '{"repositoryId":"demo"}'
```

- Builds (or reuses with `--skip-build`) the handler.
- Loads either inline JSON (`--input-json`), a file (`--input <path>`), or the config's `tests.sampleInputPath`.
- Executes the handler and prints logs, metrics, result payload, and runtime duration.

Use this harness to exercise new parameters or to regression-test changes before packaging.

## Publishing

```
apphub jobs publish . \
  --token dev-operator-token \
  --registry-url http://127.0.0.1:4000 \
  --capability custom-flag
```

1. Rebuilds and packages (unless `--artifact <path>` supplies a prebuilt tarball).
2. Base64 encodes the tarball and attaches the SHA-256 checksum.
3. Sends a `POST /job-bundles` request with manifest, derived capability flags, metadata, and artifact payload.
4. Prints the registry response (including download URL when available).

Authentication options:

- `--token <value>` or `APPHUB_TOKEN` environment variable.
- `--registry-url <url>` or `APPHUB_REGISTRY_URL` (defaults to `http://127.0.0.1:4000`).

When `--artifact` is provided, the CLI skips packaging and reuses the supplied tarball after recomputing the checksum locally.

## Tips & Troubleshooting

- Keep TypeScript handlers deterministic; external network access should be declared via `capabilities` so the runtime can enforce policy.
- Update `tests/sample-input.json` (or provide a custom path) with representative payloads for `apphub jobs test`.
- If validation fails, the CLI prints the JSON Schema path and error message. Fix the manifest and re-run the command.
- Clean builds (`rm -rf dist artifacts`) before packaging to avoid accidentally including stale files when tweaking glob patterns.

For additional context on jobs and the registry, revisit `JOBS_SPEC.md` and ticket 006.
