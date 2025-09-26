# 018 – Rework example bundle packaging and cache

## Context

- The example job bundles (e.g. `observatory-duckdb-loader`) are currently cached on disk under `services/catalog/data/example-bundles` and `bundle-runtime-cache` after the first import.
- Those archives can originate from a different OS (macOS in our case), which breaks native dependencies when the Linux sandbox unpacks them (`duckdb.node: invalid ELF header`).
- The job bundle publish API refuses to replace an existing version (409 on duplicates), so we have no supported path to override a bad artifact.

## Goals

1. **Backend:** Allow replacing an existing bundle version when explicitly requested (e.g. `force=true`). Safeguard the DB write with auditing so we know when a tarball was replaced.
2. **Example bundler:** Stop persisting tarballs/fingerprints on the host filesystem. Rebuild every example bundle in a clean temp workspace (copy bundle dir → `npm ci` → `npm run build` → package).
3. **Import flow:** During `/examples/import` always rebuild the bundle and publish it via the patched API (force overwrite). Store only the DB record; treat the DB as the cache.
4. **Runtime:** Make workflow/job execution stream bundle tarballs solely from the DB (or future object storage) and unpack into a fresh temp directory per run. Remove all fallback lookup of `data/example-bundles` and `bundle-runtime-cache`.
5. **Cleanup:** Delete stale filesystem caches and update docs so operators know imports always rebuild in the container and overwrite older artifacts.

## Deliverables

- API/DB migration for bundle replacement, including audit columns (`replacedAt`, `replacedBy`).
- Updated `packages/example-bundler` to rebuild bundles without reusing `node_modules` or tarball metadata across runs.
- Modified example import handler to rebuild & force-publish bundles unconditionally, and to log the new checksum/version.
- Removal of filesystem cache usage throughout the codebase.
- Documentation updates (README/docs/environmental-observatory-workflows.md) reflecting the new behaviour.

## Acceptance Criteria

- Importing the observatory example on a clean container produces Linux-native `duckdb.node`, and rerunning the import replaces the artifact without manual cleanup.
- Job executions no longer look for bundle artifacts on disk; they succeed after the rebuild even if the previous tarball was from another OS.
- No `.tgz` files linger under the repository after an import.
