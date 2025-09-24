# Retail Sales Example

The retail sales example demonstrates a two-step ingest pipeline (CSV → Parquet) and a publishing workflow that produces dashboards from the curated data.

- `jobs/` – Bundles for the CSV loader, Parquet builder, and visualiser, each paired with a `job-definition.json` file.
- `workflows/` – JSON definitions for `retail-sales-daily-ingest` and `retail-sales-insights`.
- `data/` – Sample CSV partitions used by docs and tests. Point `dataRoot` at this directory when running the workflows locally.

Use the job definitions and workflows directly with the catalog importer or CLI (`apps/cli`) to replay the scenario end-to-end.
