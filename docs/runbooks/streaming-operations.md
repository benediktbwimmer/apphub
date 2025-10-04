# Streaming Operations Runbook

This runbook codifies day-two procedures for AppHub's streaming stack (Redpanda, Flink, and the timestore streaming runtime). It captures startup order, recovery flows, and sizing guidance so on-call engineers can restore service quickly.

## Startup Order

1. **Redpanda** – start the broker before any downstream consumers.
   - Docker Compose: `docker compose -f docker/demo-stack.compose.yml up -d redpanda redpanda-init`
   - Minikube: `kubectl apply -k infra/minikube && kubectl rollout status statefulset/apphub-redpanda -n apphub-system`
   - Verify metrics on `http://<broker-host>:9644/metrics` and health via `rpk cluster info`.
2. **Flink** – launch the JobManager/TaskManagers after Redpanda reports healthy.
   - Compose: `docker compose ... up -d flink-jobmanager flink-taskmanager`
   - Minikube: `kubectl rollout status deployment/apphub-flink-jobmanager -n apphub-system`
   - Confirm `/v1/cluster/health` returns `HEALTHY` and `/metrics` exposes checkpoint gauges.
3. **Timestore** – boot the API, then enable streaming batchers/hot buffer.
   - `npm run dev --workspace @apphub/timestore`
   - Check `/streaming/status` and `/ready` for state `ready`.
4. **Core** – once the above are green, start `npm run dev --workspace @apphub/core` and validate `/readyz` replies with status `ready`.
5. **Smoke check** – run `npm run runSmoke --workspace @apphub/tests` or `apps/cli/bin/apphub status` to confirm streaming readiness.

## Failure Recovery

### Broker outage (Redpanda)

1. Alert: `vectorized_cluster_health_status` or `apphub_streaming_backlog_seconds` will fire (`PagerDuty` + `#apphub-ops`).
2. Inspect broker state: `kubectl logs statefulset/apphub-redpanda -n apphub-system` or `docker logs redpanda`.
3. If the pod crashed, restart sequentially (`kubectl rollout restart statefulset/apphub-redpanda`). Wait for leadership to stabilise (`rpk cluster info`).
4. After recovery, ensure `/streaming/status` reports `broker.reachable=true` and backlog gauges fall towards zero.
5. If data loss suspected, trigger partition reassignment or restore from the latest S3 snapshot (see `docs/redpanda.md#operational-checklist`).

### Micro-batcher failures

1. Alert: `timestore_streaming_flush_duration_seconds` > p95 or connectors stuck (`Streaming micro-batchers degraded`).
2. Check Timestore logs for connector errors (`npm run dev --workspace @apphub/timestore` logs or `journalctl` in prod).
3. Flush in-flight windows by restarting the streaming workers (`pkill -f timestore && npm run dev --workspace @apphub/timestore`) or redeploying the pod (`kubectl rollout restart deployment/apphub-timestore -n apphub-system`).
4. Confirm `apps/cli status` shows `batchers: N/N running` and backlog gauges decay.

### Flink checkpoint restore

1. Alert: `flink_jobmanager_completed_checkpoints_total` stalls or `flink_checkpoint_failed_total` spikes.
2. Trigger savepoint for inspection (if JobManager reachable):
   ```bash
   curl -X POST "$APPHUB_FLINK_REST_URL/jobs/<jobId>/savepoints" \
     -H 'Content-Type: application/json' \
     -d '{"target-directory": "s3://apphub-flink-checkpoints/savepoints"}'
   ```
3. Restart job from last successful checkpoint or savepoint:
   ```bash
   flink run-application \
     --target kubernetes-application \
     --fromSavepoint s3://apphub-flink-checkpoints/savepoints/<id> \
     -Dkubernetes.cluster-id=apphub-flink \
     gs://apphub-streaming-jobs/tumbling-window.jar
   ```
4. After restart, watch `/streaming/status` (`hotBuffer.state`) and `timestore_streaming_backlog_seconds` to ensure backlog clears.

## Capacity Planning

Track these signals to resize streaming components:

- **Topic lag** – `timestore_streaming_backlog_seconds` > 120s (add batchers) or `vectorized_kafka_partition_under_replicated` (scale brokers).
- **Flush throughput** – `timestore_streaming_flush_duration_seconds` and `timestore_streaming_flush_rows` (increase batch parallelism or window size).
- **Hot buffer footprint** – `timestore_streaming_hot_buffer_rows` and `timestore_streaming_hot_buffer_staleness_seconds` (tune `maxTotalRows`, `retentionSeconds`).
- **Flink checkpoints** – `flink_jobmanager_job_last_checkpoint_duration` and `flink_jobmanager_checkpoint_failed_total` (scale TaskManagers or widen checkpoint interval).

Reassess quotas monthly or after onboarding a workload that emits >50k events/minute. Update `TIMESTORE_STREAMING_BATCHERS` window sizes and Redpanda retention accordingly.
