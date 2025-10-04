# Streaming Utilities

This workspace bundles helper scripts for working with the Flink + Redpanda stack.

## Commands

```bash
# Compile TypeScript helpers (optional – scripts run via tsx)
npm run build --workspace @apphub/streaming

# Produce synthetic events to the streaming input topic
npm run seed:sample --workspace @apphub/streaming

# Submit the tumbling window SQL job through the Flink SQL client
npm run submit:sample --workspace @apphub/streaming
```

### Environment overrides

| Variable | Default | Description |
| --- | --- | --- |
| `APPHUB_STREAM_BROKER_URL` | `redpanda:9092` | Kafka/Redpanda bootstrap servers used by the helper scripts. Set to `127.0.0.1:19092` when running locally outside compose. |
| `APPHUB_STREAMING_COMPOSE_FILE` | `docker/demo-stack.compose.yml` | Compose file passed to `docker compose` when submitting the sample job. |
| `APPHUB_STREAMING_COMPOSE_PROJECT` | *(unset)* | Optional compose project name (mirrors `docker compose -p`). |
| `APPHUB_STREAMING_FLINK_SERVICE` | `flink-jobmanager` | Name of the JobManager service in the compose file. |
| `APPHUB_STREAM_INPUT_TOPIC` | `apphub.streaming.input` | Topic targeted by `seed:sample`. |

The submit script renders `tumbling-window.sql`, injects the configured broker bootstrap address, and executes the Flink SQL client inside the JobManager container (`./bin/sql-client.sh -f ...`).
