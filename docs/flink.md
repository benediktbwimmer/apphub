# Flink Streaming Runtime

Apache Flink powers AppHub's stateful stream processors once `APPHUB_STREAMING_ENABLED=1`. This document covers local tooling, deployment manifests, and operational expectations.

## Cluster Topology

| Environment | Components | Notes |
| --- | --- | --- |
| Local (docker compose) | `flink-jobmanager`, `flink-taskmanager` | Uses filesystem checkpoints mounted at `docker/demo-data/flink/checkpoints`. Web UI exposed via `APPHUB_FLINK_UI_PORT` (default 8081). |
| E2E stack | Same as above | Shares the repo root via `APPHUB_E2E_REPO_ROOT` so sample jobs are available inside the container. |
| Minikube | `apphub-flink-jobmanager` Deployment (1 replica) + `apphub-flink-taskmanager` Deployment (2 replicas) | Configuration injected via `apphub-flink-config` ConfigMap. Checkpoints land in `s3://apphub-flink-checkpoints` on the in-cluster MinIO instance. |

All deployments expose the JobManager REST API at `APPHUB_FLINK_REST_URL` (defaults: `http://flink-jobmanager:8081` in compose, `http://apphub-flink-jobmanager:8081` in Kubernetes).

## Sample Job (Kafka Tumbling Aggregation)

The repo ships a SQL-based demo that consumes events from Redpanda, performs a 1-minute tumbling aggregation per `user_id`, and emits results to an `upsert-kafka` sink:

- Source topic: `apphub.streaming.input`
- Sink topic: `apphub.streaming.aggregates`
- SQL template: `services/streaming/sample-jobs/tumbling-window.sql`

### Submit the job (docker compose)

1. Ensure the streaming stack is running:
   ```bash
   docker compose -f docker/demo-stack.compose.yml up -d redpanda redpanda-init flink-jobmanager flink-taskmanager
   ```
2. Seed sample data:
   ```bash
   npm run seed:sample --workspace @apphub/streaming
   ```
3. Submit the SQL job via the SQL client:
   ```bash
   npm run submit:sample --workspace @apphub/streaming
   ```
4. Inspect results:
   ```bash
   docker compose -f docker/demo-stack.compose.yml exec redpanda rpk topic consume apphub.streaming.aggregates -n 5
   ```

### Submit the job (minikube)

1. Apply the overlay (includes Flink, Redpanda, and supporting services):
   ```bash
   kubectl apply -k infra/minikube
   ```
2. Wait for pods:
   ```bash
   kubectl get pods -n apphub-system -l app.kubernetes.io/part-of=apphub-streaming
   ```
3. Seed data from your workstation (port-forward the Redpanda service if needed):
   ```bash
   kubectl port-forward -n apphub-system svc/apphub-redpanda 9092:9092
   APPHUB_STREAM_BROKER_URL=127.0.0.1:9092 npm run seed:sample --workspace @apphub/streaming
   ```
4. Copy the SQL template and run the SQL client inside the JobManager:
   ```bash
   JOBMANAGER_POD=$(kubectl get pods -n apphub-system -l app.kubernetes.io/component=jobmanager -o jsonpath='{.items[0].metadata.name}')
   kubectl cp services/streaming/sample-jobs/tumbling-window.sql apphub-system/$JOBMANAGER_POD:/tmp/tumbling-window.sql
   kubectl exec -n apphub-system "$JOBMANAGER_POD" -- ./bin/sql-client.sh -f /tmp/tumbling-window.sql
   ```
5. Query the sink topic:
   ```bash
   kubectl exec -n apphub-system statefulset/apphub-redpanda -- rpk topic consume apphub.streaming.aggregates -n 5
   ```

## Streaming Micro-Batcher

AppHub's timestore service includes a Redpanda-backed micro-batcher that consumes `apphub.streaming.aggregates`, groups records by dataset window, and publishes Parquet partitions via the standard ingestion pipeline. Configure batchers with `TIMESTORE_STREAMING_BATCHERS`—each descriptor specifies the dataset slug, schema, timestamp field, partition keys, and window duration. Once enabled, the worker updates watermarks (`streaming_watermarks` table) so hybrid queries can distinguish sealed intervals from hot streaming windows.

## Checkpoints & Savepoints

- **Compose / E2E** – Mounted volume `./docker/demo-data/flink/checkpoints` keeps checkpoints between restarts. Remove the directory to reset state.
- **Minikube** – Checkpoints live in `s3://apphub-flink-checkpoints`. The MinIO bootstrap job creates the bucket automatically; adjust retention policies with `mc` if required.
- **Configuration knobs** – `FLINK_PROPERTIES` (compose) and `flink-conf.yaml` (Kubernetes) set `execution.checkpointing.interval = 1 min`. Override via environment or config map to tune frequency.

To trigger a savepoint via REST:

```bash
curl -X POST "$APPHUB_FLINK_REST_URL/jobs/<jobId>/savepoints" \
  -H 'Content-Type: application/json' \
  -d '{"target-directory": "s3://apphub-flink-checkpoints/savepoints"}'
```

## Operations & Runbook Highlights

- **Scaling** – Increase `apphub-flink-taskmanager` replicas (or adjust task slots) to add compute capacity. For compose, start additional TaskManagers (`docker compose up -d flink-taskmanager`).
- **Upgrades** – Rolling updates: drain TaskManagers first (`kubectl rollout restart deployment/apphub-flink-taskmanager`), then restart the JobManager. Validate checkpoint restore before promoting changes.
- **Monitoring** – Scrape the JobManager Prometheus endpoint (`/metrics` on port 8081). Key metrics: `numRegisteredTaskManagers`, `checkpointing_duration`, `numRestarts`, and the Prometheus reporter configured in `flink-conf.yaml`.
- **Failure recovery** – If the JobManager restarts, the cluster automatically restores from the latest completed checkpoint. For catastrophic failures, restore a savepoint by passing `--fromSavepoint <path>` when submitting the job.
- **Topic hygiene** – Redpanda bootstrap scripts create the input/output topics automatically; adjust the retention window via `rpk topic alter-config apphub.streaming.aggregates --set retention.ms=...` if downstream consumers need longer history.

## Related Documentation

- [Redpanda Streaming Backbone](./redpanda.md)
- `services/streaming/README.md` (CLI usage)
- `infra/minikube/flink/` manifests for Kubernetes deployments
