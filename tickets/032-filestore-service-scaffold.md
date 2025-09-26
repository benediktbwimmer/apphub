# Ticket 032: Scaffold Filestore Service Package

## Problem Statement
We lack a runnable `services/filestore` workspace, so engineers cannot boot a Fastify API, run migrations, or publish health checks alongside catalog/metastore/timestore. Without a scaffold, subsequent tickets cannot be exercised locally.

## Goals
- Create a new `services/filestore` package mirroring existing service conventions (tsconfig, eslint, build scripts, env loading, tests, Dockerfile stub).
- Bootstrap a Fastify server with `/health`, `/ready`, `/metrics` (reusing the Prometheus plugin already shared across services) and structured logging.
- Load configuration for Postgres, Redis (BullMQ + pub/sub), filesystem roots, and S3 credentials via `serviceConfig` helper similar to other services.
- Register the service in root workspace tooling: `package.json` workspaces, `npm run dev`, Docker compose, and documentation.
- Ensure migrations from Ticket 031 run during startup (or via explicit `npm run filestore:migrate`).

## Non-Goals
- Implementing domain routes or command orchestration.
- Shipping production Docker/Kubernetes manifests; focus on local + CI viability.

## Implementation Sketch
1. Copy bootstrap patterns from `services/metastore/src/app.ts` and `services/timestore/src/server.ts`, adapting config + logger wiring.
2. Add Fastify plugins for auth stubs, request validation scaffolding, Prometheus metrics, and Redis client injection.
3. Update root `package.json`, `tsconfig`, and `scripts/` to recognize the new service and ensure `npm run dev` wires it up.
4. Document env vars in `services/filestore/README.md` and link from `docs/filestore.md`.

## Acceptance Criteria
- `npm run dev` starts filestore next to catalog/metastore/timestore using shared Redis + Postgres settings (no Kafka).
- Health/readiness endpoints return 200 and include migration status information.
- CI lint/test/build steps succeed for the new package.
- Documentation explains how to boot the service locally with Redis inline mode for tests.
