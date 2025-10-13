# Service Registry Shared State Runbook

This runbook covers the Postgres-backed service registry introduced in Ticket 150. The registry now stores service manifests, service network definitions, and health snapshots in shared tables so multiple core replicas stay consistent.

## Schema Overview

| Table | Purpose |
| --- | --- |
| `service_manifests` | Versioned manifest payloads keyed by module + service slug. Old rows are superseded but retained for audit. |
| `service_networks` | Persisted network records with stored manifest JSON and checksum. Members live in `service_network_members`. |
| `service_health_snapshots` | Point-in-time health checks with latency, status code, and metadata. Latest row per service drives API responses. |

## Bootstrap & Backfill

1. **Migrate** – `npm run lint --workspace @apphub/core` (runs typecheck + migrations automatically) or invoke `ensureDatabase()` in the core process.
2. **Backfill manifests** – run the helper script from repo root:

   ```bash
   npm run backfill:service-registry -- --path modules/observatory/dist --module observatory
   ```

   - The script loads the module (`service-manifests/service-manifest.json`) and writes through the new registry. Placeholders leverage the defaults baked into the module, so no extra flags are required.
   - Add `--var KEY=VALUE` to override placeholders, or `--no-bootstrap` if bootstrap actions should run.

3. **Verify import** – `psql` or API:
   ```bash
   psql $DATABASE_URL -c "select service_slug, module_id, module_version from service_manifests where superseded_at is null order by service_slug;"
   curl -s http://localhost:4000/services | jq '.data[] | {slug, health}'
   ```

## Minikube Validation

1. Deploy two core replicas (`kubectl scale deploy core-api --replicas=2`). Ensure `REDIS_URL` points to the shared cluster so cache invalidations broadcast.
2. Port-forward the core API (`kubectl port-forward deploy/core-api 4000:4000`).
3. Run the backfill script against the minikube endpoint (uses shared Postgres):
   ```bash
   DATABASE_URL=postgres://... npm run backfill:service-registry -- --path modules/observatory/dist
   ```
4. Hit `/services` on both pods (repeat port-forward with `kubectl exec`) — both should return identical manifest and `health` metadata blocks.
5. Trigger the background poller once (or PATCH the service) and confirm a new row appears in `service_health_snapshots`; the other pod’s `/services` response updates within the polling interval.

## Rollout Steps

- **Staging**
  1. Deploy migrations + new core build with feature flag `APPHUB_SERVICE_REGISTRY_DUAL_WRITE=1` (if required).
  2. Run the backfill script.
  3. Tail core logs for `[service-registry]` miss/hit ratios; expect cache hits after first load.
  4. Scale to two replicas and verify manifests stay in sync when importing via UI.

- **Production**
  1. Announce maintenance window; ensure Redis is healthy (fail-fast behaviour trips readiness otherwise).
  2. Run backfill, confirm `/services` includes `health` metadata and `service_manifests` has active rows.
  3. Flip feature flag to single-write once confidence achieved.
  4. Monitor query latency dashboards (look for `service_manifests` / `service_health_snapshots` indices).

## Rollback

1. Scale core replicas to one to avoid divergence.
2. Set `APPHUB_SERVICE_REGISTRY_USE_SHARED_STATE=0` (or revert commit).
3. Truncate the new tables if unrecoverable (`DELETE FROM service_manifests; DELETE FROM service_health_snapshots;`) — they are append-only.
4. Redeploy previous build.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `/services` hangs or 500s | Confirm Postgres reachable; check `service_manifests` indices exist (`\d service_manifests`). |
| Health data stale | Verify Redis URL is not `inline` in multi-pod environments; missing invalidations keep caches hot forever. |
| Backfill fails with placeholder errors | Re-run with explicit `--var KEY=VALUE` overrides. The event-driven module documents required keys in `service-manifests/README.md`. |
| Duplicate manifests | Check for multiple imports of the same module from different git refs. Active rows are unique on `(module_id, module_version, service_slug)`; superseded rows are safe to keep. |
| Module-scoped dashboards show empty workflow data | Run `npm exec --workspace @apphub/core -- tsx src/scripts/backfillModuleContexts.ts` to seed workflow definition/run contexts for the affected module, then redeploy core. |

## Reference Commands

```bash
# Diff active manifest payloads
psql $DATABASE_URL -c "select module_id, service_slug, checksum from service_manifests where superseded_at is null order by module_id, service_slug;"

# Inspect latest health snapshot for the gateway module
psql $DATABASE_URL -c "select status, latency_ms, checked_at from service_health_snapshots where service_slug = 'observatory-dashboard' order by version desc limit 1;"
```

Use `modules/observatory/dist` as the canonical smoke test module whenever verifying shared registry behaviour locally or in staging.
