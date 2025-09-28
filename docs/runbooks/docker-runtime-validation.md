# Docker Runtime Validation & Rollout (Legacy)

> The Docker job runner is deprecated in favour of the Kubernetes-based build and launch platform described in `remote-build-launch.md`. Use this runbook only when maintaining the legacy fallback (`APPHUB_BUILD_EXECUTION_MODE=docker`).

## Overview
- Validates the catalog Docker job runner end-to-end using the new integration suite in `services/catalog/tests/dockerRuntimeValidation.e2e.ts`.
- Covers filestore staging, container execution, output collection, and job telemetry without depending on external Docker or Filestore services.
- Designed for operators planning the staged rollout of Docker jobs across environments while CI and dashboard automation remain pending.

## Automated Coverage
- Run the validation locally before promotions:
  - `npm run test --workspace @apphub/catalog -- --runInBand services/catalog/tests/dockerRuntimeValidation.e2e.ts`
  - or `npx tsx services/catalog/tests/dockerRuntimeValidation.e2e.ts`
- The harness assembles a synthetic Docker job, emulates filestore transfers, runs the Docker CLI through a deterministic mock, and asserts:
  - Inputs land on disk and stay within workspace limits.
  - The container produces stdout/stderr plus an output artifact.
  - Filestore uploads succeed and emit metadata into the job result, metrics, and context payloads.
- Failures surface actionable log lines from the mock Docker process so regressions are debuggable without live containers.

## Manual Validation Checklist (Staging)
- Preconditions
  - Docker daemon accessible to the catalog workers (`LAUNCH_RUNNER_MODE=docker`).
  - Filestore base URL (`CATALOG_FILESTORE_BASE_URL`) and credentials present in the deployment environment.
  - Redis and Postgres healthy (`/readyz` reports ready).
- Dry Run
  - Execute the integration test command above on a staging host to ensure mocks resolve correctly.
  - Trigger a representative Docker job through the catalog UI or API with sample inputs mirrored from production filestore paths.
  - Confirm `job_runs.context->docker` includes workspace stats, exit code, and log tail; `job_runs.metrics->filestore` should show bytes in/out > 0.
  - Verify uploaded artifacts by fetching the path declared in the job definition and inspecting checksums.
- Rollback Plan
  - Switch `LAUNCH_RUNNER_MODE=stub` on workers to keep scheduling but bypass Docker execution.
  - Disable the Docker job toggle or feature flag in the catalog UI to prevent new launches.
  - Clean up residual containers or workspaces with `docker rm -f apphub-*` and by pruning `/tmp/apphub-docker*` directories.

## Production Rollout Checklist
- Communication & Scheduling
  - Announce deployment window and affected tenants two business days ahead.
  - Coordinate with operations on filestore capacity and Docker socket access on worker hosts.
- Enablement Steps
  - Roll out new worker image/config with Docker mode enabled to a single canary instance.
  - Run the validation test suite against the canary workers.
  - Launch smoke-test jobs referencing production filestore paths; confirm success and artifact integrity.
  - Gradually expand to remaining workers while monitoring job success rate and worker CPU/memory headroom.
- Post-Launch Monitoring (temporary approach)
  - Watch catalog worker logs for `docker`-tagged entries and elevated failure rates.
  - Track job run metrics in the database (`SELECT status, COUNT(*) FROM job_runs WHERE runtime='docker' GROUP BY 1;`).
  - Capture manual notes on runtime performance for future dashboard automation.

## Known Gaps / Follow-Ups
- CI integration is deferred; rerun the validation script manually after relevant merges until pipeline coverage is wired up.
- Dedicated dashboards and alerting remain TODO—rely on worker logs and ad-hoc queries for now.
- Extend the fake Docker harness or swap to real container execution when a CI runner with nested Docker support becomes available.
