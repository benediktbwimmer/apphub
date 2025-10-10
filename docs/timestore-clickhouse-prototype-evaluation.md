# ClickHouse Timestore Prototype Evaluation Plan

## Overview
The goal of the prototype is to validate that ClickHouse can replace DuckDB as the staging/query engine inside timestore for small-to-medium demo workloads. This plan defines what we will test, which datasets participate, how we measure success, and the playbook for running and reporting the evaluation.

## Scope
- Environment: single-node demo stack (`docker/demo-stack.compose.yml`) with ClickHouse + MinIO tiering enabled.
- Data volume: synthetic demo datasets seeded by hot buffer + manual API requests (target ≤ 10 GB compressed).
- Participants: timestore API, ingestion workers, hot buffer, observatory dashboards.
- Out of scope: production multi-node durability, migrations from existing DuckDB data, streaming backfills.

## Success Criteria
| Category | Target | Measurement |
| --- | --- | --- |
| Ingestion latency | ≤ 1 s p95 per batch (rows ≤ 5 k) | `timestore_ingest_duration_seconds` histogram |
| Read-after-write | Queries immediately return newly ingested rows | Functional verification + metric `x-timestore-replica-age-ms` < 5 000 |
| Query latency | ≤ 400 ms p95 for demo dashboards (<= 100 k rows scanned) | `timestore_query_duration_seconds` (clickhouse backend label) |
| Disk usage | Hot tier stable (< 5 GB) and cold tier grows after TTL | `timestore_clickhouse_disk_bytes` gauges |
| Stability | No ingestion/query crashes over 24h continuous run | Service logs/healthchecks |

Prototype passes when all success criteria are met for 3 consecutive demo runs (seed → query → observe TTL migration) and no high-severity issues remain.

## Datasets & Workloads
1. **Observatory Time Series** (existing demo module)  
   - Continuous hot buffer ingests every 30 s.  
   - Dashboard queries every 60 s via scripted curl/Playwright.
2. **Workflow Runs Streaming** (synthetic)  
   - Seed via `npm run seed:sample --workspace @apphub/streaming`.  
   - Periodic ClickHouse SQL validation queries (count, sample windows).
3. **Ad-hoc ingestion**  
   - Manual REST ingestion for schema evolution (add column) and backfill scenarios.

## Execution Checklist
1. **Setup**
   - [ ] Build demo stack images (`docker/demo-stack.compose.yml`).  
   - [ ] Ensure ClickHouse config mounted (`docker/clickhouse/config.d`).  
   - [ ] Configure `.env` with TTL (`TIMESTORE_CLICKHOUSE_TTL_DAYS`) and tokens.
2. **Start stack**
   - [ ] `docker compose -f demo-stack.compose.yml --env-file demo.env up -d`.  
   - [ ] Wait for `demo-bootstrap` completion.
3. **Seed data**
   - [ ] Run streaming/job seed scripts.  
   - [ ] Trigger manual ingestion variations (baseline + additive schema).
4. **Observation window (24h)**
   - [ ] Hit timestore endpoints (SQL + API) every 5 min (automated script).  
   - [ ] Record metrics snapshots (Prometheus or `curl /metrics`).  
   - [ ] Monitor ClickHouse disk usage + S3 events hourly.
5. **TTL verification**
   - [ ] After TTL window (e.g., 1 day → adjust to 1 hour for quick tests) confirm `system.parts` shows moved volumes.  
   - [ ] Validate NVMe free space unchanged after movement.
6. **Shutdown / cleanup**
   - [ ] Collect logs (`docker compose logs clickhouse timestore`).  
   - [ ] Export ClickHouse table metadata (`SHOW CREATE TABLE`).  
   - [ ] Stop stack and archive data directory for repeat runs.

## Measurement & Tooling
- **Metric capture**:  
  - Prometheus (if available) or `curl http://localhost:4200/metrics` saved every 5 min.  
  - ClickHouse metrics via `docker compose exec clickhouse clickhouse-client --query "..."`
- **Functional scripts**:  
  - `scripts/timestore/validate-clickhouse.ts` (to be added) for query + row count checks.  
  - Dashboard smoke tests using `npm run test --workspace @apphub/frontend` (subset).
- **Data sampling**:  
  - `clickhouse-client` queries: `SELECT count(), max(__received_at) FROM ts_observatory_timeseries_records`.

## Reporting Template
```
Prototype Run #<id> (date range)
- Ingestion latency (p95/p99): ...
- Query latency (p95/p99): ...
- Replica age (max/avg): ...
- Disk usage (local vs S3): ...
- Errors: (list or "none")
- Observations: (notes on TTL, schema changes, etc.)
- Verdict: pass/fail + next steps
```

## Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| TTL too long for demo evaluation | Allow overriding `TIMESTORE_CLICKHOUSE_TTL_DAYS` (e.g., set to `1/24` for hourly) |
| S3 credentials drift between envs | Document overrides (`TIMESTORE_S3_*`) in demo guide |
| Metrics stale due to query failure | `updateClickHouseMetrics` logs warnings; include manual fallback command in checklist |
| Demo stack resource exhaustion | Monitor `docker stats`; reduce concurrency or dataset size if CPU > 90% |

## Owners & Timeline
- **Prototype driver**: Timestore team (Ben W.)  
- **Observability support**: Ops/Infra for metrics access  
- **Target completion**: 2 weeks from start (includes repeat runs if criteria unmet)

## Next Steps After Evaluation
- If PASS: refine scale assumptions, draft migration RFC, plan next milestone (multi-tenant sharding tests).  
- If FAIL: capture root causes, update redesign doc with blockers, decide whether to iterate or pause ClickHouse adoption.

