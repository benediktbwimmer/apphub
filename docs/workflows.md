# Workflow Management API

The catalog service exposes authenticated REST endpoints for managing workflow event triggers. All routes require an operator token with the `workflows:write` scope (local development can set `APPHUB_AUTH_DISABLED=1`).

## Admin UI

The Workflows console now includes an **Event Triggers** tab alongside the definition and asset views. Operators with `workflows:write` permission can:

- Inspect all triggers for the selected workflow, including status badges, throttle limits, and Liquid parameter templates.
- Review live scheduler health (matched/throttled/failed counts, pause reasons) sourced from `/admin/event-health`.
- Drill into recent delivery attempts with inline status filters and timestamps.
- Create, edit, enable/disable, or delete triggers with form validation for JSONPath predicates, throttles, and JSON payloads.
- Open the event sample drawer to evaluate predicates and render parameter templates against recent envelopes before saving changes.
- Use the schema explorer to inspect sampled event fields, generate JSONPath predicates, and insert Liquid parameter snippets directly into the form.

The UI calls the same endpoints described below and surfaces API validation messages inline, so operators can manage event-driven scheduling without leaving the browser.

### Scheduler Coordination & Scaling

The workflow scheduler now coordinates replica ownership using Postgres advisory locks. Enable the coordination loop by setting `WORKFLOW_SCHEDULER_ADVISORY_LOCKS=1` on every catalog workflow worker. The active leader obtains `pg_try_advisory_lock` on a well-known namespace, renews the lock with a keepalive, and materialises due schedules while holding schedule-level `pg_try_advisory_xact_lock` guards. Replica pods that cannot obtain the leader lock idle until the active coordinator relinquishes control.

Lock acquisition, contention, optimistic conflict, and processing counters are surfaced through `/admin/event-health` under the new `workflowScheduler` payload (the Admin UI renders the same data on **Event Health**). Alerts fire if a replica fails to acquire the leader lock for more than 30 seconds or if schedule-level locks persistently contend.

When running in minikube—or promoting to production—scale workflow workers with the feature flag enabled so two replicas share scheduling responsibilities safely:

```yaml
# helm upgrade catalog ./charts/catalog -f values.yaml -f minikube-values.yaml
catalog:
  workflowWorker:
    replicas: 2
    env:
      WORKFLOW_SCHEDULER_ADVISORY_LOCKS: "1"
      WORKFLOW_SCHEDULER_INTERVAL_MS: "5000"
      WORKFLOW_SCHEDULER_BATCH_SIZE: "10"
```

The same values file can be applied to staging/production clusters—just omit the minikube overrides. With coordination enabled, you should observe exactly one run per schedule window during a 10-minute soak even with two workers. Review `/admin/event-health` for lock contention metrics before promoting the rollout.

## Event Trigger Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/workflows/:slug/triggers` | List triggers for a workflow. Supports `status`, `eventType`, and `eventSource` filters. |
| `POST` | `/workflows/:slug/triggers` | Create a trigger. Validates predicates, throttles, and parameter templates before persistence. |
| `GET` | `/workflows/:slug/triggers/:triggerId` | Fetch a single trigger definition. |
| `PATCH` | `/workflows/:slug/triggers/:triggerId` | Update name, filters, throttles, parameter template, or status. Version increments automatically when material fields change. |
| `DELETE` | `/workflows/:slug/triggers/:triggerId` | Remove a trigger and its delivery history. |
| `GET` | `/workflows/:slug/triggers/:triggerId/deliveries` | Inspect recent delivery attempts (supports `status`, `eventId`, `dedupeKey`, and `limit` up to 200). |

### Create Payload Example

```json
POST /workflows/directory-sync/triggers
{
  "name": "Directory updates",
  "description": "Launch when the employee namespace changes",
  "eventType": "metastore.record.updated",
  "eventSource": "metastore.api",
  "predicates": [
    { "path": "$.payload.namespace", "operator": "equals", "value": "hr" },
    { "path": "$.payload.key", "operator": "in", "values": ["employees", "contractors"] }
  ],
  "parameterTemplate": {
    "namespace": "{{ event.payload.namespace }}",
    "recordKey": "{{ event.payload.key }}"
  },
  "throttleWindowMs": 60000,
  "throttleCount": 10,
  "maxConcurrency": 3,
  "idempotencyKeyExpression": "{{ event.metadata.upsertId }}"
}
```

Successful responses return the stored trigger record including computed metadata (`version`, timestamps, and actor fields). Validation errors are surfaced with detailed field messages.

### Predicate Operators

Predicates evaluate JSONPath expressions against the incoming event envelope. Each predicate entry accepts one of the following operators:

- `exists` — matches when the JSONPath resolves to at least one value. Must not include `value`, `values`, or `flags` fields.
- `equals` / `notEquals` — compare the JSONPath result to a single `value`. String comparisons are case-insensitive by default; set `caseSensitive: true` to require exact casing.
- `in` / `notIn` — expect the JSONPath result to appear inside the provided `values` array (up to 100 entries). String comparisons honour `caseSensitive`.
- `gt`, `gte`, `lt`, `lte` — perform numeric comparisons against a single `value`. The input must be a finite number; string results from JSONPath are coerced when they represent valid numbers.
- `contains` — requires a `value` and succeeds when the JSONPath resolve is a string containing the substring or an array containing an element equal to the value. Strings default to case-insensitive matching unless `caseSensitive: true` is provided.
- `regex` — applies a regular expression `value` to string results. Optional `flags` support the safe ECMAScript subset (`g`, `i`, `m`, `s`, `u`, `y`); duplicate characters are ignored. Setting `caseSensitive: false` automatically injects the `i` flag, while `caseSensitive: true` rejects any `i` flag.

Predicates are evaluated with AND semantics. Invalid combinations—such as missing operands, non-numeric values for comparison operators, or malformed regex patterns—are rejected during trigger creation with descriptive errors.

### Delivery Inspection

`GET /workflows/directory-sync/triggers/:triggerId/deliveries?status=failed&limit=20` returns the most recent delivery attempts (ordered by creation time) so operators can review failures without querying Postgres directly. Sensitive payloads are omitted; only delivery metadata (run key, run ID, status, error text, dedupe key, timestamps) is exposed.

## CLI Support

The internal CLI (`apps/cli`) provides shortcuts for the API. Commands default to `http://127.0.0.1:4000` and read `APPHUB_TOKEN`; override with `--catalog-url` / `--token` when needed.

```
apphub workflows triggers list <workflow-slug> [--status active|disabled] [--event-type type] [--event-source source]

apphub workflows triggers create <workflow-slug> --file trigger.yml [--yes]

apphub workflows triggers update <workflow-slug> <trigger-id> [--file patch.json] [--status active|disabled] [--yes]

apphub workflows triggers disable <workflow-slug> <trigger-id> [--yes]
```

- Definition files may be JSON or YAML.
- `--yes` skips the interactive confirmation prompt.
- Responses and validation errors from the API surface directly in the CLI for quick iteration.

See `npm run workflow-triggers -- --help` inside `apps/cli` for the full command tree once the package is built.

## Durable Retry Foundations

The retry durability work ships in stages. This ticket introduces the shared persistence primitives that later phases will activate:

- `workflow_trigger_deliveries` now stores `retry_state`, `retry_attempts`, and `retry_metadata` so throttled deliveries can be rescheduled without dropping the original context.
- `workflow_run_steps` captures `next_attempt_at`, `retry_state`, `retry_attempts`, and `retry_metadata` to let workflow orchestration persist retry plans across process restarts.
- A new `event_ingress_retries` table tracks source-level throttles with `retry_state`, `attempts`, and `next_attempt_at` timestamps. Workers will rely on this table to reconcile BullMQ jobs.
- Retry backoff timings are configurable via `EVENT_TRIGGER_RETRY_BASE_MS`, `EVENT_TRIGGER_RETRY_FACTOR`, `EVENT_TRIGGER_RETRY_MAX_MS`, and `EVENT_TRIGGER_RETRY_JITTER_RATIO` for trigger deliveries (plus analogous `EVENT_RETRY_*` variables for source retries).

Apply the accompanying migration before enabling any runtime changes. Future tickets will wire these columns into the scheduler, workflow orchestrator, and UI workflows.
