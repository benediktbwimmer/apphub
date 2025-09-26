# Environmental Observatory Example

This example models a network of field instruments that land minute-by-minute CSV readings into an inbox. A chain of jobs normalises each drop, streams the rows into Timestore, generates visualisations, and publishes Markdown/HTML/JSON reports. Everything needed to replay the scenario lives in this directory:

- `jobs/` – Node job bundles with `job-definition.json` metadata used by the importer and tests.
- `workflows/` – Declarative workflow definitions for the data generator, minute ingest, and publication DAGs.
- `services/` – The observatory-aware watcher service plus a dashboard that visualises freshly published reports.
- `service-manifests/` – Service manifest/config JSON for registering the watcher and dashboard with the catalog.
- `data/` – Fixture dataset (inbox, staging, archive, warehouse, plots, reports) used by docs and automated tests.

To package a job or register a workflow manually, point the CLI or API at the JSON artefacts in `jobs/` or `workflows/`. The watcher service defaults to the paths under `data/`, so you can run it locally with `npm run dev` from `services/observatory-file-watcher` and drop CSVs into `data/inbox` to exercise the flow end-to-end. Launch the dashboard with `npm run dev` from `services/observatory-dashboard` to see `status.html` refresh automatically as new partitions publish.

The `observatory-minute-data-generator` workflow wraps the `observatory-data-generator` job to drop synthetic minute-level instrument CSVs into `data/inbox`. Schedule it alongside the watcher to simulate live instruments without manual file copies. The inbox normalizer copies each matching CSV into `data/staging/<minute>/` for downstream jobs, then moves the source file into `data/archive/<instrument>/<hour>/<minute>.csv` so retries do not reprocess the same payload. When jobs run with filesystem access in the sandbox, AppHub mirrors the host root automatically so absolute drop locations (for example `/Users/bene/work/observatory/inbox`) still land on your machine.
