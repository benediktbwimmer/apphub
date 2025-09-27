# Timestore Observability & SLO Instrumentation

This document outlines the new observability hooks added for ticket 029. It covers exported metrics, tracing options, and recommended alerts for maintaining SLOs across ingestion, queries, and lifecycle workers.

## Prometheus Metrics

Metrics are exposed via the Fastify `/metrics` endpoint and follow the `timestore_` prefix by default. The endpoint is guarded by the `TIMESTORE_METRICS_SCOPE` (or the global admin scope) and can be disabled via `TIMESTORE_METRICS_ENABLED=false`.

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `timestore_ingest_requests_total` | Counter | `dataset`, `mode`, `result` | API ingestion request throughput, separated by inline vs queued and success vs failure. |
| `timestore_ingest_duration_seconds` | Histogram | `dataset`, `mode` | Wall-clock latency for ingestion HTTP requests. |
| `timestore_ingest_queue_jobs` | Gauge | `state` | Bull queue depth across `waiting`, `active`, `completed`, `failed`, `delayed`, `paused`. |
| `timestore_ingest_jobs_total` | Counter | `dataset`, `result` | Actual ingestion job execution results (inline + worker). |
| `timestore_ingest_job_duration_seconds` | Histogram | `dataset` | Ingestion processing duration (driver write + metadata). |
| `timestore_query_requests_total` | Counter | `dataset`, `mode`, `result` | Query throughput and failure counts. |
| `timestore_query_duration_seconds` | Histogram | `dataset`, `mode` | End-to-end query execution time. |
| `timestore_query_row_count` | Histogram | `dataset`, `mode` | Result row volume for sizing dashboards. |
| `timestore_query_remote_partitions_total` | Counter | `dataset`, `cache_enabled` | Remote partition fetches, useful for cache hit/miss ratios (compare with total queries). |
| `timestore_lifecycle_jobs_total` | Counter | `dataset`, `status` | Lifecycle job execution outcomes. |
| `timestore_lifecycle_job_duration_seconds` | Histogram | `status` | Lifecycle execution latency. |
| `timestore_lifecycle_operations_total` | Counter | `operation`, `status` | Compaction, retention, and parquet export summaries. |
| `timestore_lifecycle_queue_jobs` | Gauge | `state` | Lifecycle queue depth by status. |
| `timestore_http_requests_total` | Counter | `method`, `route`, `status` | HTTP observability for dashboards. |
| `timestore_http_request_duration_seconds` | Histogram | `method`, `route` | HTTP latency SLI. |

### Suggested Alerts

- **Ingestion availability**: alert when `rate(timestore_ingest_requests_total{result="failure"}[5m]) / rate(timestore_ingest_requests_total[5m]) > 0.05` for 10 minutes.
- **Ingestion latency**: track `histogram_quantile(0.95, rate(timestore_ingest_duration_seconds_bucket{mode="inline"}[5m]))` and page when above 5 seconds.
- **Queue backlog**: warn if `timestore_ingest_queue_jobs{state="waiting"}` or `timestore_lifecycle_queue_jobs{state="waiting"}` exceeds 100 for more than 5 minutes.
- **Query latency**: alert on `histogram_quantile(0.95, rate(timestore_query_duration_seconds_bucket[5m])) > 2` seconds.
- **Lifecycle failures**: page when `increase(timestore_lifecycle_jobs_total{status="failed"}[30m]) >= 1`.
- **Remote partition spikes**: track ratio `rate(timestore_query_remote_partitions_total[5m]) / rate(timestore_query_requests_total[5m])` to catch cache regressions.

## Tracing

When `TIMESTORE_TRACING_ENABLED=true`, the service initialises an OpenTelemetry tracer (`@opentelemetry/api`). Current spans:

- `timestore.ingest` (HTTP ingestion route)
- `timestore.ingest.process` (dataset persistence)
- `timestore.query` (HTTP query route)

Spans emit dataset slug, actor scopes (when available), remote partition counts, and success/error status. The tracer defaults to the service name `timestore`; override via `TIMESTORE_TRACING_SERVICE_NAME`.

## Configuration Reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `TIMESTORE_METRICS_ENABLED` | `true` | Enable/disable Prometheus instrumentation. |
| `TIMESTORE_METRICS_COLLECT_DEFAULT` | `true` | Collect Node.js runtime metrics. |
| `TIMESTORE_METRICS_PREFIX` | `timestore_` | Metrics namespace. |
| `TIMESTORE_METRICS_SCOPE` | admin scope fallback | Required IAM scope for `/metrics`. |
| `TIMESTORE_TRACING_ENABLED` | `false` | Toggle OpenTelemetry spans. |
| `TIMESTORE_TRACING_SERVICE_NAME` | `timestore` | Span service identifier. |

## Dashboard Notes

Create dedicated dashboards for:

1. **Ingestion SLI**: request throughput, job duration, queue depth, failure percentage.
2. **Query SLI**: request rate, p95/p99 latency, row counts, remote partition counts (overlay with cache configuration).
3. **Lifecycle Health**: job outcomes, execution latency, queue backlog, per-operation counters.

For day-to-day triage, operators can browse `/services/timestore` in the frontend to inspect dataset metadata, manifests, and the recent lifecycle job history without leaving the UI. When deeper analysis is needed, the SQL editor at `/services/timestore/sql` provides dark-mode aware editing, autocomplete driven by live schema metadata, result exploration (table/JSON/chart), and an in-browser query history so common diagnostics stay one click away.

Surface these alongside existing admin APIs. For manual triage, `services/timestore/src/routes/admin.ts` still exposes JSON summaries via `/admin/lifecycle/status`; the Prometheus metrics ensure parity for automated monitoring.

## Event Publishing

Lifecycle hooks (parquet exports, partition creation, retention sweeps) now publish to the shared event bus so downstream automation can respond. Example:

```ts
import { createEventPublisher } from '@apphub/event-bus';

const publisher = createEventPublisher();

await publisher.publish({
  type: 'timestore.dataset.export.completed',
  source: 'timestore.lifecycle',
  payload: {
    datasetSlug,
    manifestId,
    storageTargetId,
    filePath,
    rowCount
  },
  correlationId: jobId
});
```

The catalog ingests the event into `workflow_events`, exposes it over `/ws`, and surfaces it in `GET /admin/events` for live debugging.

Additional events emitted:
- `timestore.partition.created` whenever ingestion finalizes a new partition/manifest.
- `timestore.partition.deleted` when retention removes partitions (payload includes reasons).

## Dataset Access Audit API

The admin surface now exposes dataset access history without direct SQL access. Call `GET /admin/datasets/:datasetId/audit` with the `timestore:admin` scope to retrieve paginated audit records, sorted from newest to oldest.

- `limit` (default 50, max 200) controls page size.
- `cursor` resumes from a previous response (`nextCursor` encodes `{ createdAt, id }`).
- `action` or repeated `actions` narrow results to specific event names (`ingest.requested`, `query.executed`, etc.).
- `success=true|false` filters on outcome.
- `startTime` / `endTime` accept ISO-8601 timestamps to bound the window.

Example response:

```json
{
  "events": [
    {
      "id": "da-0b6c6a0f-4e8f-42ce-a9d4-f6e5688efa6d",
      "datasetId": "ds-12345",
      "datasetSlug": "observatory-admin-audit",
      "actorId": "robot-two",
      "actorScopes": ["admin-scope", "query-scope"],
      "action": "query.executed",
      "success": true,
      "metadata": {
        "stage": "query",
        "manifestId": "dm-test",
        "rowCount": 42
      },
      "createdAt": "2024-05-13T19:22:11.123Z"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTA1LTEzVDE5OjIyOjExLjEyM1oiLCJpZCI6ImRhLTBiNmM2YTBmLTRlOGYtNDJjZS1hOWQ0LWY2ZTU2ODhlZmE2ZCJ9"
}
```

Frontends can depend on the shared typings in `@apphub/shared/timestoreAdmin` (`datasetAccessAuditEventSchema`, `datasetAccessAuditListResponseSchema`, `datasetAccessAuditListQuerySchema`) to render audit timelines and build query UIs without duplicating validation.
