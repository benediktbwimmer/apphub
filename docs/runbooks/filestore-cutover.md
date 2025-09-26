# Filestore Cutover Runbook

> **Audience:** Platform operations, service owners migrating to Filestore-managed storage paths, Oncall.
>
> **Status:** Living document – update after every cutover rehearsal.

## 1. Scope & Roles

- **Primary services:** Filestore API, reconciliation workers, Metastore/Timestore consumers, downstream workloads that previously wrote directly to shared storage.
- **Oncall (Platform):** Owns production toggles, monitors queues/metrics, executes rollback if required.
- **Service Owner:** Prepares application-specific configuration, validates data after cutover, signs off.
- **SRE (observer):** Verifies SLO dashboards, alert routes, and log coverage.

## 2. Prerequisites & Readiness Checklist

| Item | Description | Owner | Status |
| --- | --- | --- | --- |
| ✅ Filestore schema migrated | `npm run migrate --workspace @apphub/filestore` applied for target environment. | Platform | |
| ✅ Redis connectivity | `FILESTORE_REDIS_URL` reachable; inline mode only for dev/staging. | Platform | |
| ✅ Reconciliation worker | `npm run reconcile --workspace @apphub/filestore` (or container) deployed with queue concurrency sized for environment. | Platform | |
| ✅ Metastore/Timestore consumers | `METASTORE_FILESTORE_SYNC_ENABLED`/`TIMESTORE_FILESTORE_SYNC_ENABLED` enabled with correct channel/key prefix. | Platform | |
| ✅ IAM/token updates | `FILESTORE_TOKEN` issued with `filestore:write` (operators) and service-specific tokens distributed. | Security / Service Owner | |
| ✅ Watchers configured | Local: chokidar watcher pointing at mounted directories. S3: scheduled list jobs configured (`filestore_watchers.yaml`). | Platform | |
| ✅ Rollback assets | Snapshot of journal & node tables (`pg_dump filestore nodes journal_entries`), copy of original filesystem tree (rsync/tar). | Service Owner | |
| ✅ CLI installed | `npx filestore --help` tested from bastion; confirm SSE stream by running `npx filestore events:tail --event filestore.node.created`. | Operator | |

## 3. Observability & SLOs

| SLO | Target | PromQL / Check | Alert Trigger | Notes |
| --- | --- | --- | --- | --- |
| API availability | ≥ 99.9% monthly | `sum(rate(filestore_http_requests_total{status!~"5.."}[5m])) / sum(rate(filestore_http_requests_total[5m]))` | < 99.5% for 10 min (page) | Derived from Fastify handler metrics. Correlate with ALB/ingress logs before paging storage teams. |
| Command success rate | ≥ 99.5% weekly | Same expression filtered to `{status=~"2.."}` vs totals OR DB check:<br/>`SELECT sum((status='succeeded')::int)*100.0/count(*) FROM journal_entries WHERE created_at > now()-interval '1 hour';` | >1% failures for 15 min (ticket) & >5% (page) | For false positives (idempotent replay), inspect `journal_entries.error`. |
| Reconciliation backlog | Waiting jobs < 100, 95th percentile duration < 60s | `filestore_reconciliation_queue_depth{state="waiting"}`<100<br/>`histogram_quantile(0.95, sum(rate(filestore_reconciliation_job_duration_seconds_bucket[5m])) by (le))` | Backlog > 100 for 10 min (page). | Run `npx filestore reconcile:enqueue` to verify worker behaviour. |
| Rollup freshness | 95% nodes updated < 15 min | `histogram_quantile(0.95, sum(rate(filestore_rollup_freshness_seconds_bucket[15m])) by (le))` | > 900 s (15 min) for 30 min (ticket). | Large tree recalculations rely on background queue; coordinate with reconciliation backlog alerts. |
| Event delivery | Metastore/Timestore lag < 5 min | Compare `filestore_http_requests_total{route='/v1/events/stream'}` to consumer logs; in Grafana chart `MAX(journal_id) - MAX(node_state.last_journal_id)` using `filestore_node_state` table. | If lag ≥ 5 min or consumers disconnected (warning). | CLI tail of SSE stream should show parity with downstream dataset ingestion. |

**Dashboard recommendations**

- Build Grafana board with panels:
  - HTTP availability (`filestore_http_requests_total` stacked by status) and latency histogram (`filestore_http_request_duration_seconds`).
  - Queue depth gauges for rollup/reconciliation (`filestore_rollup_queue_depth{state='waiting'}`, `filestore_reconciliation_queue_depth{state='waiting'}`).
  - Reconciliation outcome counters (`filestore_reconciliation_jobs_total` grouped by `outcome`).
  - Custom SQL panel against Postgres to surface `journal_entries` failure rate and aging `nodes.consistency_state`.
- Add Loki/Splunk log query: `service=filestore level>=error` filtered by `reqId` to correlate CLI invocations with backend traces.

## 4. Staging Dry-Run Procedure

1. **Freeze manual access** to the target directory (readonly mount or at least broadcast to engineers).
2. **Seed metadata**: import existing nodes using bulk scripts or by replaying from backup into Filestore (e.g. `npx filestore directories:create` for top-level folders, `filestore ingest` pipeline for files).
3. **Enable watchers** in staging; confirm drift events via `npx filestore events:tail`. Expect `filestore.drift.detected` when you mutate the filesystem out of band.
4. **Switch service config** to point writes to Filestore SDK/CLI. For HTTP clients, update `FILESTORE_BASE_URL` & tokens.
5. **Run smoke tests**:
   - Create sample directories/files via CLI.
   - Verify Metastore record appears (`npm run test --workspace @apphub/metastore` optional) or run SQL query on `metastore_records`.
   - Check Timestore dataset contains new rows (`SELECT * FROM filestore_activity LIMIT 5;`).
6. **Monitor metrics** for at least 30 minutes. Confirm reconciliation backlog drains and no SLO thresholds are breached.
7. **Record outcomes** in the runbook checklist and update `docs/runbooks/filestore-cutover.md` with any lessons learned.

## 5. Production Cutover Steps

1. **Change freeze window approved** (prefer low-traffic period; notify consumers).
2. **Snapshot state**: `pg_dump -n filestore --data-only` and filesystem backup (rsync) for impacted paths.
3. **Disable cron jobs / scripts** that directly write to storage; switch services to SDK-based writes (feature flag or config release).
4. **Run sanity commands** once Filestore becomes the only writer:
   - `npx filestore directories:create <backend> <path>` for a harmless directory; verify HTTP 201.
   - `npx filestore nodes:stat <backend> <path>` to confirm metadata.
   - `npx filestore events:tail --event filestore.node.created` to ensure SSE stream is alive.
5. **Monitor SLO dashboards** continuously for first 2 hours. Pay attention to reconciliation queue depth and consumer lag.
6. **Enable drift enforcement** (if required): set watchers to `enforce=true`, ensure reconciliation jobs automatically resolve external mutations.
7. **Handover to service owner** once data validity is confirmed (Metastore/Timestore alignment, application behaviour correct).

## 6. Post-Cutover Validation

- Run automated regression suite or manual smoke tests for application endpoints that interact with storage.
- Query `journal_entries` for `status='failed'` in last hour; zero tolerance post-cutover.
- Ensure reconciliation metrics stabilized (no continuous backlog).
- Confirm dashboards & alerts are wired into oncall rotation (ping tests, alert preview mode).
- Update runbook checklist with timestamp, participants, success status.

## 7. Rollback Procedure

1. **Stop new Filestore writes**: toggle feature flag or revert configuration to direct filesystem access.
2. **Disable watchers & reconciliation**: stop BullMQ worker (`npm run reconcile --workspace @apphub/filestore` -> ctrl+c or scale deployment to 0) and set watcher `ENABLED=false`.
3. **Drain queues**: `npx filestore events:tail` should stop; check Redis `keys filestore:reconcile_queue*` – empty queue ensures no pending jobs.
4. **Restore filesystem snapshot** if Filestore wrote partial data (rsync backup back to mount).
5. **Revert database** if necessary: apply `pg_restore` from snapshot or run targeted delete on `journal_entries` / `nodes` inserted after cutover.
6. **Re-enable legacy access scripts** and communicate to stakeholders.
7. **File incident report** capturing root cause, metrics, and actions.

## 8. Reference Commands & Templates

- **CLI reference**
  ```bash
  # Directory creation
  npx filestore directories:create 1 datasets/new-project --metadata '{"owner":"data-eng"}'

  # Delete with recursion
  npx filestore nodes:delete 1 datasets/tmp --recursive

  # Enqueue reconciliation
  npx filestore reconcile:enqueue 1 datasets/customer-dump --reason audit --detect-children

  # Tail events
  npx filestore events:tail --event filestore.node.missing
  ```

- **Prometheus alert expression (example)**
  ```promql
  (sum(rate(filestore_http_requests_total{status=~"5.."}[5m])) /
   sum(rate(filestore_http_requests_total[5m]))) > 0.005
  ```
  Trigger after `5m` for warning, `15m` for critical.

- **Redis queue health check**
  ```bash
  redis-cli -u "$FILESTORE_REDIS_URL" hgetall filestore:bull:filestore_reconcile_queue:meta
  ```

- **Database lag check**
  ```sql
  SELECT backend_mount_id, COUNT(*)
  FROM nodes
  WHERE consistency_state <> 'active'
    AND updated_at > now() - interval '15 minutes'
  GROUP BY 1;
  ```

## 9. Sign-off Template

| Field | Value |
| --- | --- |
| Environment |  |
| Date / Time |  |
| Participants |  |
| Pre-flight checklist complete |  |
| SLOs stable (Yes/No) |  |
| Issues observed |  |
| Rollback executed? |  |
| Follow-up actions |  |

> Store completed templates in the operational wiki and update this runbook with lessons learned.

