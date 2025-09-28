# Ticket 110: Extend Job Runtime Schema for Docker

## Problem
Job definitions only recognise `node` and `python` runtimes (`services/catalog/src/db/types.ts`), so catalog cannot persist or validate a Docker-backed job. Without schema support we cannot register upcoming image-based workloads or capture the metadata necessary for execution (image tag, config template, input/output descriptors).

## Proposal
- Update the job runtime enum and related database constraints/migrations to include a `docker` variant.
- Define a typed metadata contract (e.g. `DockerJobMetadata`) describing image, command/entrypoint, config template path, filestore input/output descriptors, resource hints, and capability flags (network, gpu, etc.).
- Extend job definition creation/update APIs to validate the new metadata structure with zod schemas, returning actionable errors for misconfiguration.
- Introduce feature flagging so Docker jobs are rejected unless `CATALOG_ENABLE_DOCKER_JOBS` (or similar) is enabled, easing rollout.
- Document the metadata schema and required environment in `docs/jobs/docker-runtime.md`.

## Deliverables
- Postgres migration adding `'docker'` to the `job_runtime` enum plus backfill/validation.
- TypeScript updates reflecting the new runtime and metadata interfaces across catalog services and shared packages.
- Request/response validation enhancements in `services/catalog/src/routes/jobs.ts` with unit tests.
- New documentation describing Docker job definitions and migration guidance for clients.

## Risks & Mitigations
- **Enum migration downtime:** Perform an additive enum change with transactional safety; test on staging before prod rollout.
- **Metadata drift:** Keep the metadata schema versioned and validated with zod to avoid silent acceptance of malformed definitions.
- **Feature flag gaps:** Ensure the flag is checked in both write-path validation and job execution to prevent partially configured environments from running Docker workloads.
