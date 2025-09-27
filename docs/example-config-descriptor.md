# Example Config Descriptor

Example modules now describe their runtime surface through a root-level `config.json`. The descriptor keeps placeholder metadata, manifest references, bootstrap actions, and additional assets in one place so services no longer have to embed `$var` definitions directly in each manifest.

## Schema
- JSON Schema: [`docs/schemas/example-config.schema.json`](schemas/example-config.schema.json)
- TypeScript: `exampleConfigDescriptorSchema` exported from `services/catalog/src/serviceConfigLoader.ts`

Descriptors accept the existing service-manifest payloads plus:
- `placeholders`: default values and descriptions keyed by placeholder name. Services keep using `${PLACEHOLDER}` strings while metadata flows from the descriptor.
- `manifests`: list of relative manifest files to load. Use this instead of the legacy `manifestPath` when you have multiple manifest fragments.
- `assets`: optional references (files, documentation, diagrams) that downstream tooling can surface alongside the module.
- `bootstrap`: unchanged bootstrap plan schema; actions can reference `{{ placeholders.* }}` just like before.

## Example
```jsonc
{
  "$schema": "../../docs/schemas/example-config.schema.json",
  "module": "github.com/apphub/examples/environmental-observatory-event-driven",
  "manifests": [
    { "path": "./service-manifests/service-manifest.json" }
  ],
  "placeholders": [
    {
      "name": "OBSERVATORY_DATA_ROOT",
      "description": "Base directory on the host where observatory datasets and artifacts are stored.",
      "default": "examples/environmental-observatory-event-driven/data"
    }
  ],
  "bootstrap": {
    "actions": [
      { "type": "ensureDirectories", "directories": ["{{ placeholders.OBSERVATORY_DATA_ROOT }}/staging"] }
    ]
  }
}
```

## Authoring Notes
1. Place the descriptor at the module root so imports can omit `configPath` (the loader looks for `config.json` before `service-config.json`).
2. Keep manifest env values as literal `${PLACEHOLDER}` strings; descriptor defaults supply the resolved values and surface documentation for operators.
3. Retain `service-config.json` only while migrating. When possible, point tooling at the descriptor to avoid duplicating placeholder metadata.
