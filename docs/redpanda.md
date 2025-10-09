# Redpanda Streaming Backbone

Redpanda backs AppHub's durable event log whenever `APPHUB_STREAMING_ENABLED=1`. The cluster complements, rather than replaces, Redis:

- **Redis** continues to power BullMQ queues, ephemeral caches, and inline event fallbacks.
- **Redpanda** stores ordered event streams, ingestion telemetry, and workflow envelopes with replay semantics and retention policies.

## Topics & Retention

| Topic | Purpose | Default Partitions | Default Replication | Retention |
| --- | --- | --- | --- | --- |
| `apphub.core.events` | Authoritative stream of core domain events (apps, builds, launches) | 6 | 3 (1 in local/dev) | 7 days (`retention.ms=604800000`)
| `apphub.ingestion.telemetry` | Ingestion metrics, partition build outcomes, and lifecycle traces | 6 | 3 (1 in local/dev) | 3 days (`259200000` ms)
| `apphub.workflows.events` | Scheduler envelopes, trigger deliveries, and workflow step status | 6 | 3 (1 in local/dev) | 7 days (`604800000` ms)
| `apphub.workflows.runs` | Workflow run lifecycle snapshots (`workflow.run.*` events) | 6 | 3 (1 in local/dev) | 7 days (`604800000` ms)
| `apphub.jobs.runs` | Job run lifecycle events (`job.run.*`) with status transitions and metadata | 6 | 3 (1 in local/dev) | 7 days (`604800000` ms)
| `apphub.streaming.input` | Raw windowed aggregation input used by the Flink sample job | 6 | 3 (1 in local/dev) | 7 days (`604800000` ms)
| `apphub.streaming.aggregates` | Tumbling window output emitted by Flink and consumed by downstream services | 6 | 3 (1 in local/dev) | 7 days (`604800000` ms)

Adjust retention via `rpk topic alter-config` as downstream storage needs evolve.

## Feature Flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `APPHUB_STREAMING_ENABLED` | `false` | Boots Redpanda/Timestore streaming dependencies and enables runtime status checks. |
| `APPHUB_STREAM_MIRROR_WORKFLOW_RUNS` | `false` | Mirror workflow run lifecycle changes into the workflow Redpanda topic. |
| `APPHUB_STREAM_MIRROR_WORKFLOW_EVENTS` | `false` | Mirror workflow event envelopes (step transitions, triggers) into Redpanda. |
| `APPHUB_STREAM_MIRROR_JOB_RUNS` | `false` | Mirror job/build/launch lifecycle events for auditing. |
| `APPHUB_STREAM_MIRROR_INGESTION` | `false` | Mirror ingestion telemetry and dataset ingest events for replay. |
| `APPHUB_STREAM_MIRROR_CORE_EVENTS` | `false` | Mirror the general core domain event bus (repositories, services, assets). |

Flip the per-producer mirrors alongside `APPHUB_STREAMING_ENABLED=1` once topics are provisioned and downstream ingestion (Flink/Timestore) is ready.

Optional publisher controls:

- `APPHUB_STREAM_CLIENT_ID` (default `apphub-core-stream`) customises the Kafka client id used for mirrored producers.
- `APPHUB_STREAM_CONNECT_TIMEOUT_MS` (default `5000`) bounds producer connection attempts.
- `APPHUB_STREAM_PUBLISH_TIMEOUT_MS` (default `10000`) bounds acknowledgement waits for mirrored messages.
- `APPHUB_STREAM_TOPIC_WORKFLOW_RUNS` (default `apphub.workflows.runs`) controls where workflow run lifecycle mirrors are written.
- `APPHUB_STREAM_TOPIC_WORKFLOW_EVENTS` (default `apphub.workflows.events`) overrides the workflow event mirror topic.
- `APPHUB_STREAM_TOPIC_JOB_RUNS` (default `apphub.jobs.runs`) sets the topic for mirrored job run lifecycle events.
- `APPHUB_STREAM_TOPIC_INGESTION` (default `apphub.ingestion.telemetry`) routes repository ingestion telemetry.
- `APPHUB_STREAM_TOPIC_CORE_EVENTS` (default `apphub.core.events`) sets the topic for general core domain events (builds, launches, assets, services).

Prometheus exports `apphub_stream_mirror_publish_total{result}` and `apphub_stream_mirror_publish_duration_ms{result}` from Core. Alert when `result="failure"` increases or duration p95 degrades.

## Local Development

- `npm run dev` optionally spins up a single-node Redpanda container (`APPHUB_STREAMING_ENABLED=1`). The dev runner automatically:
  1. Boots Redpanda (`docker` required).
  2. Creates the baseline topics above (replication factor forced to 1).
  3. Produces and consumes a probe message to verify round-trip connectivity using `kafkajs`.
- The broker advertises `127.0.0.1:${APPHUB_DEV_REDPANDA_PORT:-19092}`; services read this via `APPHUB_STREAM_BROKER_URL`.
- Data persists in `${APPHUB_DATA_ROOT}/redpanda` so restarts do not wipe offsets.
- Use `npm run seed:sample --workspace @apphub/streaming` to push demo events into `apphub.streaming.input` before running the Flink sample job.

### Compose Stack

`docker/demo-stack.compose.yml` and `docker/e2e-stack.compose.yml` define a `redpanda` service plus a one-shot `redpanda-init` container that bootstraps topics. Override the following in `.env` to expose different ports or toggle streaming:

```env
APPHUB_STREAMING_ENABLED=true
APPHUB_STREAM_BROKER_URL=redpanda:9092
APPHUB_REDPANDA_PORT=19092
APPHUB_REDPANDA_ADMIN_PORT=19644
```

## Minikube & Kubernetes

The `infra/minikube` overlay now includes a three-node `StatefulSet`:

- `apphub-redpanda` (client service) and `apphub-redpanda-headless` (peer discovery) expose ports 9092, 9644, and 8082.
- Pods advertise their fully-qualified DNS names so in-cluster clients connect via `apphub-redpanda.apphub-system.svc.cluster.local:9092`.
- Persistent volume claims request `10Gi` per broker. Update `volumeClaimTemplates` for production storage classes.
- Configure services with `APPHUB_STREAM_BROKER_URL=apphub-redpanda:9092` and flip `APPHUB_STREAMING_ENABLED=1` once the cluster is healthy (see `/v1/cluster/health` on the admin port).

### Operational Checklist

1. **Provisioning** – apply the Redpanda manifests _before_ enabling streaming in Core/Timestore so health checks can gate rollout.
2. **Topic bootstrap** – run `rpk topic create` (or `docker compose run redpanda-init`) in staging/production to ensure retention settings match the table above. Use replication factor 3.
3. **Monitoring** – scrape the admin endpoint (`:9644/metrics`) and alert on:
   - `vectorized_cluster_health_status` ≠ 1
   - `vectorized_storage_log_segments_created_total` spikes
   - `vectorized_kafka_request_latency_seconds` p99 > 250ms
4. **Disaster recovery** – configure periodic snapshots (e.g., S3) of `/var/lib/redpanda/data`. The runbook recommends hourly incremental backups and demonstrates partition reassignment with `rpk cluster move-partitions`.
5. **Upgrades** – roll nodes sequentially. Drain each pod (`kubectl exec ... -- rpk cluster maintenance enable`) before restart to avoid controller churn.

## Metrics & Alerting

- Kubernetes services ship with `prometheus.io/scrape` annotations targeting port 9644 so the platform Prometheus stack automatically ingests broker metrics.
- Core streaming alerts rely on `vectorized_kafka_broker_partition_under_replicated`, `vectorized_kafka_recovery_partition_movement_recency`, and `timestore_streaming_backlog_seconds` to detect lag and durability regressions.
- Local compose environments expose the admin API via `${APPHUB_REDPANDA_ADMIN_PORT:-19644}` for ad-hoc inspection or temporary Prometheus scrapes.
- Use `GET /health` (or `/readyz`) on the core service to inspect `features.streaming.publisher`. The payload now includes per-topic mirror diagnostics, current feature-flag state, and event source drop counters so operators can confirm that custom HTTP publishers are being mirrored into Redpanda.

## Integration Summary

- Core and Timestore read `APPHUB_STREAM_BROKER_URL` when `APPHUB_STREAMING_ENABLED=1`; health endpoints return `503` if the broker is misconfigured.
- Redis remains mandatory. Redpanda is additive for streaming workloads and can be toggled off without impacting existing batch functionality.
- The CLI (`apphub status`) now surfaces streaming readiness to simplify operator checks.
- Every mirrored payload now includes `ingressSequence`, `kafkaPartition`, and `kafkaOffset` so downstream consumers can sort deterministically. The demo stack provisions a dedicated `sequencer-db` Postgres instance that the core service uses via `APPHUB_EVENT_SEQUENCE_DATABASE_URL` to mint these IDs.

Refer to `docs/streaming.md` (future streaming service spec) for pipeline-level wiring and schema contracts once the streaming workspace lands.
