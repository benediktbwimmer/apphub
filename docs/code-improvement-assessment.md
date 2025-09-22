# Codebase Improvement Assessment

## Overview
Apphub ships a React single-page surface that manually switches between catalog search, service gallery, workflow operations, import tools, and API access views inside a shared navigation context rather than a router-driven layout.【F:apps/frontend/src/App.tsx†L1-L83】 The catalog backend now composes domain-specific Fastify plugins (repositories, services, workflows, jobs, AI helpers, etc.) that live under `services/catalog/src/routes/`, keeping the top-level `server.ts` focused on bootstrap and registration.【F:services/catalog/src/server.ts†L1-L120】【F:services/catalog/src/routes†L1-L200】 Background ingestion, build, and orchestration flows remain powered by BullMQ queues with inline fallbacks and bespoke workers.【F:services/catalog/src/queue.ts†L1-L220】【F:services/catalog/src/ingestionWorker.ts†L920-L1092】 The PostgreSQL data layer exposes plain SQL helpers with significant custom query construction for search relevance scoring.【F:services/catalog/src/db/repositories.ts†L200-L360】 The sections below highlight targeted refactorings, removals, and quality-of-life improvements that can reduce complexity and unlock maintainability.

## Frontend Opportunities

### Adopt a Router and Remove Legacy Tab Handling
The main application component persists tab state in `localStorage`, performs legacy slug normalization (mapping `submit`/`import-manifest` to `import`), and manually renders each view conditional on the active tab.【F:apps/frontend/src/App.tsx†L11-L76】 Introducing a client-side router (React Router or TanStack Router) would remove the need for bespoke storage plumbing, improve deep linking, and make the legacy tab aliases removable after verifying that historical links are no longer consumed. As part of the migration, delete `normalizeStoredTab` once external links have been updated and enforce canonical routes for each feature surface.【F:apps/frontend/src/App.tsx†L17-L55】

### Extract Shared Data Fetching & Polling Utilities
`ServiceGallery` implements manual polling with `setTimeout`, local abort controller lifecycles, and bespoke error normalization to refresh service health.【F:apps/frontend/src/services/ServiceGallery.tsx†L122-L199】 Similar patterns appear across the workflows area (e.g., repeated `fetch` orchestration, toast wiring). Consolidating this logic into reusable hooks (e.g., `usePollingResource`, `useApiCollection`) would eliminate duplicated cleanup code, centralize error formatting, and make it easier to add exponential backoff or stale-while-revalidate semantics. Once the shared hook exists, remove the bespoke polling blocks from `ServiceGallery` and other consumers in favor of the shared abstraction.

### Decompose the Workflows Screen Into Focused Modules
`WorkflowsPage` weighs in at over 1,200 lines, mixing list filtering, WebSocket synchronization, editor dialog orchestration, AI builder triggers, and manual run submission state in a single component.【bdfba6†L1-L1】【F:apps/frontend/src/workflows/WorkflowsPage.tsx†L1-L200】 Extracting feature slices into dedicated hooks/components (e.g., `useWorkflowSummaries`, `WorkflowRunList`, `WorkflowRunDetail`) will reduce render churn and make local state easier to reason about. This opens the door to code removal too: after extraction, any unused helper (such as inline JSON formatting utilities) can be dropped if superseded by shared utilities.

### Normalize Service Preview Rendering
`ServiceGallery`’s `ServicePreviewCard` hosts fullscreen toggles and sandboxed iframes inline.【F:apps/frontend/src/services/ServiceGallery.tsx†L54-L120】 Consider extracting a shared `PreviewFrame` component used across catalog cards and service previews so duplicated fullscreen wiring and iframe attribute management can be removed from individual feature surfaces. This also enables centralizing CSP-related tweaks when preview capabilities evolve.

## Backend Opportunities

### Split Fastify Routes Into Domain Modules
The Fastify server aggregates authentication, repository ingestion, build management, service registry, jobs, workflows, AI helpers, and bundle publishing in one file alongside all validation schemas.【F:services/catalog/src/server.ts†L1-L120】【6ffd0f†L1-L1】 Refactoring into domain-specific plugins (e.g., `routes/repositories.ts`, `routes/workflows.ts`) would trim the entrypoint, allow lazy loading of rarely used scopes, and remove duplicated operator-scope guards. As part of this effort, relocate shared Zod schemas to per-domain modules and delete inline duplicates once callers import the shared definitions.

### Consolidate Queue Configuration and Handlers
`queue.ts` manually constructs four BullMQ queue instances with near-identical options and inline-mode checks, then repeats job-run wiring in each enqueue helper.【F:services/catalog/src/queue.ts†L1-L220】 Introduce a small factory (`createQueue(name, defaults)`) that returns typed enqueue helpers to remove duplicated option objects, and centralize inline execution logic so queue-specific functions only express payload shaping. After adoption, the redundant `ensure*JobHandler` flags and repeated job-run bootstrapping blocks can be deleted in favor of a generic `runJobInline('repository-ingest', handlerImporter)` helper.

### Modularize the Ingestion Pipeline
`processRepository` currently handles git cloning, metadata extraction, tag normalization, preview aggregation, database persistence, build scheduling, and job-metric reporting sequentially inside the worker.【F:services/catalog/src/ingestionWorker.ts†L950-L1092】 Extracting those concerns into dedicated modules (e.g., `gitRepository.ts`, `metadata/readPackage.ts`, `metadata/previews.ts`) would allow unit testing each stage, reuse logic for manual refresh endpoints, and remove utility glue (such as `createTagMap`/`addTag`) from the worker file once shared helpers are introduced. The worker can then orchestrate a pipeline array, making it easier to remove deprecated metadata detectors or to plug in future enrichment steps.

### Streamline Repository Search Computation
The repository data access layer builds SQL strings manually, computes text-search relevance in TypeScript, and duplicates tag filters for every query.【F:services/catalog/src/db/repositories.ts†L200-L360】 Moving relevance scoring into SQL (using `ts_rank_cd` weights and JSON aggregations) or materialized views would let the TypeScript layer drop the custom `computeComponent` logic and eliminate the bespoke clause builder once parameterized helpers or a query builder are introduced. Auditing consumers after the refactor will reveal dead utilities (e.g., manual tokenization helpers) that can be safely removed.

## Targeted Cleanups & Removals

- **Legacy Tab Aliases** – After routing migration, remove the special cases for `submit` and `import-manifest` in `normalizeStoredTab` to delete dead code paths tied to historical URLs.【F:apps/frontend/src/App.tsx†L17-L24】
- **Polling Timeouts** – Once a shared polling hook exists, eliminate the manual `setTimeout` management in `ServiceGallery` and rely on the abstraction’s cleanup so the local `timeoutId`/`controller` bookkeeping can go away.【F:apps/frontend/src/services/ServiceGallery.tsx†L128-L199】
- **Queue Handler Flags** – Generic inline job execution will make the `ingestionHandlerLoaded`/`buildHandlerLoaded` booleans redundant, enabling their removal along with associated `ensure*` helpers.【F:services/catalog/src/queue.ts†L11-L27】
- **Manual Relevance Counters** – Shifting relevance math into SQL will allow deleting `computeComponent`, token iteration loops, and other TypeScript-side scoring helpers that currently duplicate database capabilities.【F:services/catalog/src/db/repositories.ts†L200-L360】

## Next Steps
1. Prototype a router-based navigation rewrite focused on catalog vs. workflow routes, validating deep links and replacing the legacy tab state.
2. Introduce a `usePollingResource` hook, migrate `ServiceGallery`, and catalog additional call sites for consolidation.
3. Incrementally extract Fastify routes into plugins, starting with workflows (highest complexity) to unblock dedicated request validation modules.
4. Define ingestion pipeline modules and add targeted tests around tag extraction before deleting worker-local helpers.
5. Explore Postgres-side search views or stored functions, then delete redundant TypeScript scoring utilities once parity is confirmed.

Executing these steps will shrink the most complex files, eliminate duplicated infrastructure code, and make room for faster feature iteration across Apphub’s catalog, services, and workflow experiences.
