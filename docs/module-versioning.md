# Module Versioning & Administration

The module runtime now tracks 2 layers of versioning:

- **Module version** – the semver attached to the bundle published through `module.ts`.
- **Target version** – the semver attached to each exported job, workflow, or service target. Targets inherit the module version unless authors set an explicit value.

Historically CI enforced a version bump whenever target implementations changed. That automation has been removed, so it is now up to module authors to increment either the target version or the inherited module version before shipping changes.

## Working with versions

1. Set a `version` on the target declaration, e.g.:
   ```ts
   export const exampleJob = createJobHandler({
     name: 'example-job',
     version: '1.2.0',
     handler
   });
   ```
   Jobs that omit `version` inherit the module metadata version and the checker expects the module version to change instead.
2. Rebuild the module (`npm run build --workspace <module>`) and republish via `npm run module:publish -- --register-jobs` when you are ready to roll out.

## Admin tooling

Use the new CLI to inspect modules, toggle enablement, and pin job definitions to specific target builds:

```bash
# list modules with status and latest published version
npm run module:admin -- --list

# show the targets available on a module (defaults to the latest bundle)
npm run module:admin -- --show-targets environmental-observatory

# disable or re-enable a module
npm run module:admin -- --disable environmental-observatory
npm run module:admin -- --enable environmental-observatory

# pin a job definition to a precise target version
npm run module:admin -- \
  --pin-job apphub.environmental-observatory.observatory-data-generator \
  --module environmental-observatory \
  --module-version 0.1.0 \
  --target observatory-data-generator \
  --target-version 1.3.0
```

Disabling a module blocks its targets from loading in the worker runtime. Pinning rewrites the job definition’s module binding so future runs stay on the requested target version until republished.
