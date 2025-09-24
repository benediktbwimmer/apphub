# Job Bundle Migration Runbook

This runbook captures the staged rollout procedure for migrating the filesystem utility jobs (`fs-read-file`, `fs-write-file`) from legacy handlers to sandboxed bundles.

## Prerequisites
- Published bundles `fs-read-file@1.0.0` and `fs-write-file@1.0.0` exist in the job registry and match the legacy handler behaviour.
- Catalog service is deployed with ticket 009 changes (bundle-aware runtime, telemetry, feature flags).
- Observability dashboards include the `sandbox` metrics/context fields recorded on job runs.

## Configuration Flags
The runtime checks a set of environment variables to determine whether to prefer bundles and whether legacy fallbacks are allowed.

| Variable | Behaviour |
| --- | --- |
| `APPHUB_JOB_BUNDLES_ENABLED` | Global toggle. When set to `1`/`true`, the runtime prefers bundles over legacy handlers (default: disabled). |
| `APPHUB_JOB_BUNDLES_ENABLE_SLUGS` | Comma-separated list of job slugs that should prefer bundles even if the global flag is off. |
| `APPHUB_JOB_BUNDLES_DISABLE_SLUGS` | Comma-separated list of slugs that must remain on legacy handlers even if the global flag is on. |
| `APPHUB_JOB_BUNDLES_DISABLE_FALLBACK` | When `true`, disables legacy fallback globally. Use only after verification. |
| `APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS` | Comma-separated list of slugs that must not fallback (default allows fallback). |

Fallback executions mark the job run with `metrics.bundleFallback = true` and include a `bundleFallback` block in the run context (slug, version, reason). Monitor for these signals to confirm migration readiness.

## Rollout Steps
1. **Staging Validation**
   - Deploy catalog service with bundle runtime changes to staging.
- Set `APPHUB_JOB_BUNDLES_ENABLE_SLUGS=fs-read-file,fs-write-file`.
   - Run end-to-end smoke tests (`npm run test:e2e --workspace @apphub/catalog`, or targeted job workflows) and manual job triggers.
   - Confirm job runs execute via sandbox (presence of `sandbox` metrics/context). Investigate any `bundleFallback` entries.

2. **Telemetry Review**
   - Monitor staging metrics for run failures, duration regressions, or fallback occurrences.
   - Ensure new bundles emit expected logs and metrics.

3. **Production Enablement**
   - Deploy the same catalog release to production with feature flags off.
- Enable per-slug overrides: `APPHUB_JOB_BUNDLES_ENABLE_SLUGS=fs-read-file,fs-write-file`.
   - Observe runtime metrics for at least one full ingest/build cycle.
   - Once fallbacks drop to zero for 24h, set `APPHUB_JOB_BUNDLES_ENABLED=true` to make bundles the default (optional but recommended for future migrations).

4. **Finalize Migration**
   - Set `APPHUB_JOB_BUNDLES_DISABLE_FALLBACK=true` (or per-slug variant) after confirming stability. This prevents silent reversion to legacy handlers and readies the codebase for removing inline handlers.
   - Announce migration completion and schedule removal of legacy handlers (tracked separately).

## Rollback Procedure
1. Set `APPHUB_JOB_BUNDLES_DISABLE_FALLBACK=true` **off** (or remove slugs from the per-slug list) to re-enable legacy fallbacks.
2. Remove affected slugs from `APPHUB_JOB_BUNDLES_ENABLE_SLUGS` (or set `APPHUB_JOB_BUNDLES_ENABLED=false`).
3. Restart catalog workers. Job runs immediately revert to the legacy handler registrations.
4. Investigate bundle issues (registry availability, sandbox failures) before re-attempting rollout.

Record any anomalies and follow-up tasks in the incident tracker.
