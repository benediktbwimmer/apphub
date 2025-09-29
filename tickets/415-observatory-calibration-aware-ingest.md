# Ticket 415 – Apply Calibration During Observatory Ingest & Propagate Lineage

## Summary
Enhance the inbox normalizer and Timestore loader so raw ingestion applies the latest calibration per instrument, persists calibration version metadata, and exposes lineage for downstream workflows.

## Background
Existing jobs (`observatory-inbox-normalizer`, `observatory-timestore-loader`) treat raw CSV values as authoritative. To support calibration reprocessing, ingest must resolve applicable calibration records, adjust readings, and record which calibration version produced each partition. Without this, planners cannot identify stale partitions or guarantee data accuracy after calibration updates.

## Tasks
1. Extend normalizer output (`observatory.timeseries.raw` payload) with per-file calibration metadata (version id, effectiveAt) sourced from Metastore, defaulting to `null` when no calibration exists.
2. Update timestore loader to fetch calibration details for each instrument/minute, apply adjustments to readings, and include calibration version info in the ingested manifest summary.
3. Persist calibration identifiers in Metastore ingest records for audit.
4. Expand `observatory.timeseries.timestore` asset schema to capture calibration version(s) used.
5. Add logging/metrics so ingestion notes which calibration was applied.
6. Validate behaviour when calibrations change mid-run (e.g., warn if no calibration found or when effectiveAt is in the future).
7. Update unit/integration tests to cover calibrated & uncalibrated paths and verify payload schema changes.

## Acceptance Criteria
- Ingested data reflects applied calibration adjustments and records the calibration version.
- Downstream assets/events include calibration metadata.
- Tests confirm both calibrated and default scenarios.
- Documentation describes how calibration metadata flows through ingest.

## Dependencies
- Ticket 414 (calibration records/events).

## Owners
- Examples experience team with input from Timestore owners.
