# Fleet Telemetry Example

This example covers two workflows: a daily rollup that aggregates instrument CSVs into dynamic partitions, and an alerts workflow that scans those partitions for threshold breaches.

- `jobs/` – Contains the `fleet-telemetry-metrics` and `greenhouse-alerts-runner` bundles plus their `job-definition.json` metadata.
- `workflows/` – JSON definitions for `fleet-telemetry-daily-rollup` and `fleet-telemetry-alerts`.
- `data/` – Raw telemetry fixtures under `data/raw/` and an empty `data/rollups/` directory that the workflows populate.

Import the job and workflow JSON directly into the catalog or run them with the CLI to explore dynamic partitioning and alert fan-out mechanics.
