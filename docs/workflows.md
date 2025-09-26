# Workflow Management API

The catalog service exposes authenticated REST endpoints for managing workflow event triggers. All routes require an operator token with the `workflows:write` scope (local development can set `APPHUB_AUTH_DISABLED=1`).

## Admin UI

The Workflows console now includes an **Event Triggers** tab alongside the definition and asset views. Operators with `workflows:write` permission can:

- Inspect all triggers for the selected workflow, including status badges, throttle limits, and Liquid parameter templates.
- Review live scheduler health (matched/throttled/failed counts, pause reasons) sourced from `/admin/event-health`.
- Drill into recent delivery attempts with inline status filters and timestamps.
- Create, edit, enable/disable, or delete triggers with form validation for JSONPath predicates, throttles, and JSON payloads.
- Open the event sample drawer to evaluate predicates and render parameter templates against recent envelopes before saving changes.

The UI calls the same endpoints described below and surfaces API validation messages inline, so operators can manage event-driven scheduling without leaving the browser.

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

### Delivery Inspection

`GET /workflows/directory-sync/triggers/:triggerId/deliveries?status=failed&limit=20` returns the most recent delivery attempts (ordered by creation time) so operators can review failures without querying Postgres directly. Sensitive payloads are omitted; only delivery metadata (run ID, status, error text, dedupe key, timestamps) is exposed.

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
