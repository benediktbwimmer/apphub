# Repository Guidelines

## Project Structure & Module Organization
The repo is a focused monorepo. `services/catalog` houses the Fastify API and background workers written in TypeScript, with compiled output in `dist` and seed data in `data`. Persistent SQLite artifacts are stored in `services/data`. The React UI lives under `apps/frontend`, where `public` serves static assets and Vite writes builds to `dist`. Architecture notes reside in `docs/architecture.md`, and end-to-end specs currently live in `services/catalog/tests`.

## External Service Submodules
The external services and service-network manifests are tracked as Git submodules under `services/external/*` and `services/manifests/*`. After cloning the repo run `git submodule update --init --recursive` (or clone with `--recurse-submodules`) so these directories are populated. When pulling later updates, run `git submodule update --remote --merge` if you need the latest upstream revisions. Each submodule manages its own dependencies—install them inside the submodule directory (`npm install`, `pip install`, etc.) before running the local dev stack.

## Build, Test, and Development Commands
- `npm run dev` (root) launches Redis, the catalog API, ingestion worker, build worker, and frontend together; ensure `redis-server` is available on your `PATH`.
- `npm run dev` in `apps/frontend` starts the Vite dev server on `http://localhost:5173`; adjust `VITE_API_BASE_URL` in `.env.local` if the API runs elsewhere.
- `npm run dev` in `services/catalog` serves the API on `http://127.0.0.1:4000` via `tsx` live reload. Use `npm run ingest` and `npm run builds` for the queue workers.
- `npm run build` in either package produces production assets; run it before publishing containers or static bundles.
- `npm run test:e2e` inside `services/catalog` exercises the full ingest loop with an inline Redis mock and ephemeral SQLite database.

## Coding Style & Naming Conventions
TypeScript is used end-to-end with strict mode enabled. Follow the existing 2-space indentation, trailing semicolons, and camelCase filenames (`ingestionWorker.ts`, `buildRunner.ts`). Co-locate shared types near their usage and keep React components in PascalCase. Run `npm run lint` in `apps/frontend` before submitting; resolve ESLint warnings rather than ignoring them, and prefer explicit types for HTTP payloads and queue messages.

## Testing Guidelines
`services/catalog/tests/ingestion.e2e.ts` covers the ingestion happy path using Node's built-in `assert`. When extending coverage, add more `.e2e.ts` cases in the same directory and spin up required workers with `npm run ingest` if testing manually. Aim to cover new API routes or queue behaviors with end-to-end assertions and document any setup quirks in the test header comments.

## Commit & Pull Request Guidelines
Keep commit messages short, imperative, and scoped (e.g., `catalog: fix tag suggestions`, `frontend: tidy search input`). Group related changes into a single commit to ease revertability. Pull requests should describe the change, list the commands you ran (`npm run test:e2e`, `npm run lint`), mention config or data migrations, and attach screenshots or curl examples when touching UI or HTTP responses. Link to relevant issues or RFC notes in `docs/` when available.

Usually you will be located in a new empty directory. To get started, clone the repository given by the user. Then checkout a new feature branch named `feature/your-feature-name` (replace `your-feature-name` with a descriptive name for your feature). Make sure to install any dependencies and set up the development environment as described in the project's README or documentation.

While working on your feature, make sure to commit your changes frequently with clear and descriptive commit messages. Follow the project's coding style and guidelines to ensure consistency.

When you have completed your feature, run the project's tests to ensure everything is working correctly. If all tests pass, push your feature branch to the remote repository and create a pull request (PR) for review. In the PR description, provide a summary of the changes you made, any relevant issue numbers, and any additional context that might be helpful for reviewers.

## Command Execution 
Note that when you want to run commands that run indefinitely (like `npm run dev`), should use nohup and a redirection of stdout and stderr to a file, so that the command continues and you can check on the output at any time. 
