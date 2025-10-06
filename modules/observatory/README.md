# Observatory Module Template

This scaffold demonstrates how to build an AppHub module using the tooling from `@apphub/module-toolkit`.

## Commands

```bash
npm install
npm run build
npm run test
```

## Structure

- `src/settings.ts` – typed Zod schema + `createModuleSettingsDefinition` wired to shared env presets.
- `src/security.ts` – centralized principals and secrets wiring via `defineModuleSecurity`.
- `src/triggers.ts` – parameter definitions authored with the typed trigger DSL; exported via a registry.
- `src/jobs/` – job parameter definitions, also exposed through a registry.
- `src/index.ts` – barrel export for consumers.

## Generating provisioning assets

Module build tooling can import the registries and call `buildAll({ settings })` to obtain the JSON payloads expected by the module registry.

```ts
import { loadSettings } from './settings';
import { triggers } from './triggers';

const { settings } = loadSettings();
const provisioningTriggers = triggers.buildAll({ settings });
```
