# Ticket 413 – Extend Observatory Config for Calibration File Support

## Summary
Introduce first-class calibration file support in the event-driven observatory example by expanding shared configuration, storage prefixes, and documentation. Operators need a predictable place to upload calibration assets before downstream automation can react.

## Background
The current configuration (`shared/config.ts`) manages inbox, staging, archive, plots, and reports prefixes but has no concept of calibration data. Without an agreed prefix and schema the rest of the pipeline cannot resolve where calibration files live, leaving ingestion code to guess or hardcode paths.

## Tasks
1. Update `ObservatoryFilestoreConfig` (and generated JSON) with `calibrationsPrefix` (and optional `plansPrefix`) defaults under `datasets/observatory/calibrations`.
2. Teach `materializeConfig.ts` to provision the new prefixes in Filestore and persist them in `.generated/observatory-config.json`.
3. Ensure setup scripts and workflow trigger metadata expose the calibration prefix for future consumers.
4. Document the calibration file layout, naming conventions, and upload steps in the observatory README and docs.
5. Add guardrails/tests confirming the generated config includes calibration prefixes and that scripts fail fast when they are missing.

## Acceptance Criteria
- Shared config exports calibration-related prefixes and the materializer writes them into the generated config.
- Filestore hierarchy for calibrations/plans is created during bootstrap.
- README/docs describe where calibration files go and how they should be structured.
- CI/example tests load the config and assert calibration prefixes are present.

## Dependencies
- None (foundational ticket for subsequent calibration workflows).

## Owners
- Examples experience team.
