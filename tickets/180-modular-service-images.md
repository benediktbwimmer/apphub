# Ticket 180: Build Modular Service Images for Kubernetes Deployment

## Problem
The repository only publishes a single all-in-one runtime image (`Dockerfile:3-200`, `scripts/publish-runtime.sh`). That container bundles Postgres, Redis, Docker-in-Docker, the catalog API, every worker, and the frontend. A monolithic image blocks Kubernetes adoption because we need independent Deployments/Jobs per service (catalog API, build/launch workers, metastore, filestore API + worker, timestore API + workers, frontend). Without modular images we cannot scale pods individually, mount the right secrets, or trim attack surface areas inside the cluster.

## Scope
Create dedicated container images for each runtime target while reusing a common build layer. Ensure catalog workers continue to share compiled assets and Node modules without rebuilding TypeScript n times. Cover:
- Catalog API + scheduler/queue workers (shared base with process-specific CMD overrides).
- Metastore API.
- Filestore API and reconciliation worker image (same artifact + different entrypoints).
- Timestore API and background workers.
- Frontend static server image.
- Optional CLI/utilities image for admin scripts.

## Implementation
- Introduce a multi-stage build at `docker/` (or similar) that produces a cached workspace build stage, then emits per-service runtime stages (one Dockerfile with `target` aliases or separate Dockerfiles).
- Extract existing installer logic (optional rollup bundles, TypeScript builds) into the shared stage.
- Wire each runtime stage to copy only its service code, compiled `dist`, and required shared packages. Set service-specific `ENTRYPOINT`/`CMD`.
- Publish build scripts (e.g., `npm run docker:build --workspace @apphub/catalog`) to tag images for local registry + CI.
- Ensure build outputs land in `services/*/dist` prior to image assembly (`npm run build --workspaces` during build stage).
- Update `.dockerignore` so artifacts and node_modules caching behave correctly across new Docker contexts.

## Acceptance Criteria
- Each service/worked listed above has an independently buildable Docker image tagged `apphub-<service>:<tag>`.
- Images start the correct process (`node dist/server.js`, `tsx src/worker.ts`, `serve dist`, etc.).
- Catalog images share the same base so switching from API to worker is a matter of command override, not a separate build.
- Monolithic runtime image remains available until Kubernetes rollout is complete (flag or script keeps compatibility).
- CI (or local `npm run docker:build:*`) validates all new images build successfully on both amd64 and arm64 runners.

## Rollout & Risks
- Keep the existing `Dockerfile` for backward compatibility until the turnkey minikube flow is validated; mark it deprecated once charts consume the new images.
- Watch disk usage in CI—separate stages may increase layer count; use `--target` with caching to stay under limits.
- Validate that TypeScript `dist` output is identical across modular builds (compare checksums) before deleting the monolith image.
