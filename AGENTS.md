# Repository Guidelines

## Project Structure & Module Organization
AppHub runs as an npm workspace monorepo. Services live under `services/` (core API and workers, metastore, filestore, timestore). Clients sit in `apps/` (`frontend` for the Vite + React UI, `cli` for bundle tooling). Shared code belongs in `packages/`, while scenario bundles reside in `examples/`. Use `docs/` for architecture notes, `tests/` for integration harnesses, and `scripts/` for repo-wide automation. Add new modules beside the closest existing workspace to keep boundaries tidy.

## Build, Test, and Development Commands
- `npm install` — install all workspaces.
- `npm run dev --workspace @apphub/core` — run the API and workers at `localhost:4000`.
- `npm run dev --workspace @apphub/frontend` — start the Vite dev server.
- `npm run dev` — launch Redis plus the full stack via `concurrently`.
- `npm run build`, `npm run lint`, `npm run test --workspace <name>` — build, lint, or test every targeted workspace.

## Coding Style & Naming Conventions
TypeScript is used across services, with React components in `*.tsx`. Indent with two spaces, prefer single quotes, and keep trailing commas on multi-line literals. Group imports by origin: external packages, internal aliases, then relative paths. Components are PascalCase, hooks start with `use`, utilities are camelCase. Share common types through `packages/shared`. Each workspace ships an ESLint config; run lint before opening a PR.

## Testing Guidelines
The frontend relies on Vitest, and Node services use the Node test runner or `tsx` harnesses. Keep unit tests near the implementation and heavier scenarios under `tests/`. Name specs `feature.test.ts` or `feature.spec.ts`. Cover new endpoints, queue jobs, and UI flows, and describe manual validation in the PR when automation is not practical.

## Ticket Tracking
All planning now lives in GitHub Issues.
- Use `gh issue list --limit 20` to browse active tickets and `gh issue view <number>` for full context.
- Assign yourself to an issue when you start work and link your branch/PR back to it using `Fixes #<number>` or `Refs #<number>` in the description.
- Close the issue via PR merge; avoid reintroducing Markdown tickets in the repository.

## Local Git Hooks
Run these hooks locally to catch problems before review.
- One-time setup: `git config core.hooksPath .githooks`
- `pre-commit` runs `npm run lint -- --cache` as a quick sanity check.
- `pre-push` currently runs `npm run lint` and `npm run build`; re-enable `npm run test` once the suite stabilises.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `chore:`) as seen in recent history. Branch off `main` for each change (`git checkout -b <topic>`), and scope commits to a single feature or workspace. Before opening a PR, ensure `npm run lint`, `npm run build`, and the full `npm run test` sweep complete successfully. PRs must outline context, list verification commands, link tickets, and include screenshots or API transcripts for user-facing updates. Call out migrations or configuration changes in a checklist so reviewers can reproduce them.

## Environment & Security Notes
Local development expects PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`). Never commit secrets; keep them in ignored `.env.local` files. Expose `/healthz`, `/readyz`, and metrics endpoints in new services. Coordinate queue names and schema changes with operations before merging to avoid cross-service drift.
