# Ticket 137 – Metastore Realtime Stream & Filestore Sync Health

## Summary
Expose a realtime event stream and filestore sync health endpoints from the metastore service so operators can monitor record churn and background consumer lag without polling.

## Motivation
The service already emits lifecycle events to the shared event bus and consumes filestore updates, but operators lack visibility into live activity or sync health. Surfacing an SSE/WebSocket feed and health metrics will power UI dashboards and alerting while reducing the need for aggressive polling.

## Scope
- Implement an SSE endpoint (e.g., `GET /stream/records`) that forwards metastore.record.* events with minimal payloads (namespace, key, action, version, timestamps).
- Provide an optional WebSocket upgrade for future extensibility; enforce auth scopes (`metastore:read` at minimum).
- Publish filestore sync consumer health via `GET /filestore/health` (lag, last received event, retry counts) and add Prometheus metrics (`metastore_filestore_lag_seconds`, etc.).
- Integrate graceful backpressure handling to prevent leaking redis connections when clients disconnect.
- Document new endpoints and add integration tests using mocked event publishers/consumers.

## Acceptance Criteria
- SSE clients receive create/update/delete events in near-real time with heartbeat keep-alive and reconnect guidance.
- Filestore health endpoint reports lag and status, returning 503 when the consumer is stalled beyond thresholds.
- Metrics surface filestore lag and stream subscriber counts.
- Tests validate SSE framing, auth enforcement, and health thresholds.

## Dependencies / Notes
- Coordinate with infra to ensure the shared event bus supports the additional subscriber.
- Ticket 138 will consume these endpoints in the explorer.
