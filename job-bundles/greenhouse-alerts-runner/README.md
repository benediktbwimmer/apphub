# Greenhouse Alerts Runner Bundle

Prototype job bundle for the fleet telemetry example. The handler should:

1. Query the latest `greenhouse.telemetry.instrument` assets from the `telemetryDir` rollup directory.
2. Evaluate readings against humidity and temperature limits.
3. Emit a summary asset `greenhouse.telemetry.alerts` with flagged instruments and context.

Refer to `docs/fleet-telemetry-workflows.md` for orchestration details.
