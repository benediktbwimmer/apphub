# Environmental Observatory (Event-Driven)

This variant of the observatory example uses **Filestore** uploads as the system of record, **workflow event triggers** to launch minute ingest automatically, and **Timestore/Metastore** to keep downstream plots and reports current. The original file-watcher driven walkthrough still lives in `examples/environmental-observatory`; this directory contains the new event-driven stack.

## Highlights
- **Filestore first:** the data generator pushes CSVs through the Filestore API so every mutation is journaled and emitted as `filestore.command.completed` events.
- **Workflow triggers:** catalog triggers listen for those events and launch the `observatory-minute-ingest` workflow with fully materialised parameters (paths, tokens, dataset slugs) captured from the shared config file.
- **Per-instrument ingestion:** the timestore loader groups normalized rows by instrument and writes a dedicated partition (keyed by instrument + window) for each sensor, attaching the instrument id as partition attributes.
- **Timestore + Metastore:** once ingestion completes, a second trigger reacts to `timestore.partition.created` (now carrying the instrument id) and runs the publication workflow to regenerate plots and status reports, optionally upserting metadata into the Metastore.
- **Shared configuration:** operators resolve folder paths, tokens, and slugs once via `scripts/materializeConfig.ts`; both services and trigger definitions read the generated `.generated/observatory-config.json`.
- **Live visibility:** the `observatory-event-gateway` service tails the Filestore SSE stream and exposes lightweight diagnostics while the dashboard serves the latest HTML/MD/JSON report bundle.

## Directory Tour
- `data/` – sandbox directories mounted by Filestore (`inbox`, `staging`, `archive`, `plots`, `reports`) plus Timestore's local `timestore/storage` + `timestore/cache` directories.
- `jobs/` – updated Node bundles that talk to Filestore instead of the raw filesystem.
- `workflows/` – minute ingest + publication definitions with new Filestore/Timestore parameters.
- `services/` – `observatory-event-gateway` (Filestore event monitor) and the static dashboard.
- `scripts/` – helper utilities for generating the config file and provisioning workflow triggers.
- `config.json` – example descriptor wiring placeholders, bootstrap actions, and manifest references.
- `service-manifests/` – minimal manifest for the two services (they now read the shared config instead of embedding prompts).
- `shared/` – TypeScript helper for loading the config JSON from any package.

## Bootstrapping the Scenario
1. Install dependencies if you have not yet (`npm install`).
2. Generate the shared config. Set `OBSERVATORY_DATA_ROOT` once to point at the host directory where you want datasets, staging, archives, plots, reports, and DuckDB partitions to live; everything else derives from that root:
   ```bash
   OBSERVATORY_DATA_ROOT=/Users/you/observatory \
   npx tsx examples/environmental-observatory-event-driven/scripts/materializeConfig.ts
   ```
   The script writes `.generated/observatory-config.json`, provisions the Filestore backend, and ensures `TIMESTORE_STORAGE_ROOT` / `TIMESTORE_QUERY_CACHE_DIR` resolve under `OBSERVATORY_DATA_ROOT`. Keep the generated file out of source control.
3. Register the workflow event triggers:
   ```bash
   npx tsx examples/environmental-observatory-event-driven/scripts/setupTriggers.ts
   ```
   The script reads the config file, talks to the catalog API (`catalog.baseUrl`, `catalog.apiToken`), and upserts two triggers:
   - `filestore.command.completed` → `observatory-minute-ingest`
   - `timestore.partition.created` → `observatory-daily-publication`
4. Seed the data generator and publication workflows through the CLI or importer (`workflows/*.json`).
5. Launch the services:
   ```bash
   cd examples/environmental-observatory-event-driven/services/observatory-event-gateway
   npm run dev

   cd ../observatory-dashboard
   npm run dev
   ```
6. Kick off the synthetic instruments manually (`observatory-minute-data-generator` workflow) or leave the trigger to respond as Filestore uploads arrive. The event gateway will reflect upload/move activity, and the dashboard will render the latest report bundle per instrument under `/reports/<instrument>_<minute>/`.
   - Want more (or fewer) sensors? Set `OBSERVATORY_INSTRUMENT_COUNT` (alias `OBSERVATORY_GENERATOR_INSTRUMENT_COUNT`) before running `npm run obs:event:config`, or edit the generator schedule in the catalog UI afterwards. The value feeds the workflow’s `instrumentCount` parameter at runtime.

## Related Scripts
Convenience aliases (add to your global npm scripts if desired):
```json
{
  "obs:event:config": "tsx examples/environmental-observatory-event-driven/scripts/materializeConfig.ts",
  "obs:event:triggers": "tsx examples/environmental-observatory-event-driven/scripts/setupTriggers.ts"
}
```
Run them from the repo root (`npm run obs:event:config`).

## Next Steps
- Inspect/adjust the generated config file before committing to any environment.
- Extend `scripts/setupTriggers.ts` if you add workflows that should respond to Filestore/Timestore events.
- The original file-watcher example remains untouched; if you need a polling-based baseline, switch back to `examples/environmental-observatory`.
