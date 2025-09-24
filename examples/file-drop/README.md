# File Drop Example

The file drop example pairs a single relocation job with a watcher service that reacts to filesystem events. Use it to demonstrate service-triggered workflows and the workflow service-step callback pattern.

- `jobs/` – Contains the `file-relocator` bundle plus its `job-definition.json` used by the importer.
- `services/` – Fastify watcher that monitors `data/inbox`, triggers the workflow, and renders a dashboard.
- `data/` – Minimal inbox/archive fixture tree consumed by docs, tests, and the watcher defaults.
- `README.md` (this file) – High-level notes on how the pieces fit together.

Run the watcher with `npm run dev` from `services/file-drop-watcher`, drop files into `data/inbox`, and inspect relocated artefacts under `data/archive` or via the service dashboard at <http://127.0.0.1:4310/>.
