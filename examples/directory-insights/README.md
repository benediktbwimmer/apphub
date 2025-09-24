# Directory Insights Example

This example showcases the directory insights workflows: scanning a filesystem tree, rendering reports, and archiving the resulting artefacts.

- `jobs/` – Node bundles (`scan-directory`, `generate-visualizations`, `archive-report`) with matching `job-definition.json` files.
- `workflows/` – JSON definitions for the primary `directory-insights-report` workflow and the archival downstream workflow.
- `data/` – Output/archives fixtures used by docs and demonstrations. The workflows expect to write into this layout by default.

Import the job definitions and workflows via the JSON artefacts in this folder, or run them directly with the CLI for local experimentation.
