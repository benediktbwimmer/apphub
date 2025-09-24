# Fleet Telemetry Metrics Bundle

Prototype job bundle for the fleet telemetry example. The handler should:

1. Accept `dataRoot`, `instrumentId`, `day`, and `outputDir` parameters.
2. Load matching CSV files (e.g. `instrument_A/instrument_A_20240102.csv`).
3. Persist a JSON rollup to the `outputDir` and emit a result payload with `assets[0]` describing the aggregated metrics and `partitionKey` set to the instrument ID.

See `docs/fleet-telemetry-workflows.md` for full context.
