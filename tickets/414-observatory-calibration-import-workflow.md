# Ticket 414 – Build Calibration Import Workflow & Metastore Records

## Summary
Create a dedicated workflow that ingests calibration files, validates their schema, stores canonical records in the Metastore, and emits `observatory.calibration.updated` events/assets for downstream consumers.

## Background
Operators will upload calibration files per instrument to the new Filestore prefix (Ticket 413). The platform needs an automated path to parse those uploads, persist versioned calibration metadata, and notify the rest of the system so reprocessing decisions can be made. Today no workflow or event type exists to handle this lifecycle.

## Tasks
1. Define calibration file schema (per instrument offsets/gains, effective timestamp, notes) and capture it in shared TypeScript types.
2. Add `observatory.calibration.updated` to `shared/events.ts` including payload validation and publisher support.
3. Author the `observatory-calibration-import` workflow JSON with:
   - Trigger on `filestore.command.completed` scoped to `calibrationsPrefix`.
   - Job step to download, parse, and validate calibration files.
   - Job step to upsert calibration records in Metastore namespace `observatory.calibrations` (idempotent per instrument + effectiveAt).
   - Asset publication (e.g., `observatory.calibration.instrument`) capturing calibration version metadata.
4. Update setup scripts to provision the new trigger and ensure default parameters wire base URLs/tokens.
5. Write unit/integration tests covering happy-path import, schema validation failures, and duplicate uploads.
6. Document the workflow and new event in observatory docs.

## Acceptance Criteria
- Uploading a calibration file to Filestore generates a Metastore record, calibration asset, and `observatory.calibration.updated` event.
- Invalid files fail with descriptive errors and leave no partial records.
- Re-importing an identical calibration is idempotent.
- Tests exercise the workflow and new event schema.

## Dependencies
- Ticket 413 for calibration prefix and config updates.

## Owners
- Examples experience team with support from Metastore owners.
