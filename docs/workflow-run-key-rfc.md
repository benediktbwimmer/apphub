# RFC: Human-Readable Workflow Run Keys

## Status
- **Author:** Catalog platform
- **Last Updated:** 2025-09-29
- **Related Tickets:** [Ticket 200](../tickets/200-workflow-run-key-design.md) and follow-ups 201-204
- **Reviewers Needed:** Catalog/backend, Frontend, Operations, SRE

## Summary
Introduce an optional-but-encouraged human-readable `runKey` that accompanies the existing UUID `workflow_runs.id`. The key expresses business context (partition, trigger dedupe key, schedule window) and enforces Temporal-style uniqueness so only one active run with a given business identifier executes at a time. We preserve UUIDs for referential integrity while surfacing the friendly key to operators, automation clients, and observability.

## Goals
- Allow callers to supply or derive a deterministic identifier that maps a run to its business context at a glance.
- Enforce at-most-one active run per `(workflowDefinitionId, runKey)` without breaking existing UUID references.
- Surface the run key throughout APIs, UI, queue/runner telemetry, and logging to ease debugging and alert correlation.
- Provide sensible defaults for automated launch paths (scheduler, triggers, auto-materializer) so most runs receive a friendly key automatically.

## Non-Goals
- Removing or replacing the UUID primary key.
- Guaranteeing global uniqueness across workflows; uniqueness constraints apply per workflow definition.
- Rewriting historical runs to adopt the new key immediately (handled via follow-up backfill process).

## Identifier Format
- Accepts caller-provided strings up to 120 characters after trimming.
- Allowed characters: `a-z`, `0-9`, `-`, `_`, `.`, and `:`. Uppercase characters are normalized to lowercase for uniqueness comparisons but the original casing is preserved for display.
- Leading/trailing separators are stripped; internal consecutive separators are collapsed (`order--2024` → `order-2024`).
- Validation rejects keys containing whitespace, control characters, or path traversal patterns (`/`, `\`, `..`).
- Normalized key (`run_key_normalized`) is computed as:
  1. Trim.
  2. Lowercase.
  3. Replace any character outside the allowed set with `-`.
  4. Collapse consecutive `-` and trim leading/trailing `-`.

### Suggested Conventions
| Scenario | Suggested Key |
| --- | --- |
| Manual rerun for invoice 123 | `invoice-123` |
| Daily partition `2024-05-01` | `partition-2024-05-01` |
| Event trigger dedupe key `file-drop:abc123` | `event-file-drop-abc123` |
| Schedule window ending `2024-05-01T03:00Z` | `cron-2024-05-01t03` |

## Lifecycle & Collision Handling
- **Creation:** Callers may pass `runKey` when creating runs. Automated systems derive one when omitted (see "Launch Entry Points").
- **Uniqueness:** Partial unique index on `workflow_runs (workflow_definition_id, run_key_normalized)` with status filter `WHERE status IN ('pending','running')`. If a new run arrives with an active duplicate:
  - **Manual/API:** return `409 Conflict` including the existing run ID and its status. Callers may choose to requeue, cancel, or poll that run.
  - **Automated (scheduler/event/materializer):** treat as idempotent no-op and attach to the existing run (see Ticket 202). Implementation detail: retrieve existing run and return it instead of inserting a new record.
- **Completion:** When a run transitions out of active states (succeeded/failed/canceled), another run with the same key may start.
- **Reload, Retry, Resume:** Manual retry APIs must reuse the stored key. Recovery flows (heartbeat timeout, admin requeue) should copy the original key to the re-enqueued run job.

## Data Model Changes
- Add nullable `run_key` and `run_key_normalized` columns to `workflow_runs`.
- Populate normalized value via database trigger or application layer to avoid drift.
- Create partial unique index `idx_workflow_runs_active_run_key` enforcing uniqueness in active states.
- Extend row mappers, serializers, and TypeScript types to include new fields.
- Persist optional partition `attributes` alongside key fields so downstream events can expose additional dimensions (e.g., instrument id).
- Backfill script derives run keys for historical records using available metadata (partition key, trigger payload) while logging collisions. See Ticket 201.

## Launch Entry Points
| Entry Point | Behavior |
| --- | --- |
| Manual API `/workflows/:slug/run` | Accept optional `runKey`; validate and insert. On conflict, return `409`. |
| Scheduler | Derive key from schedule ID + window end (ISO minute) or supplied partition key. If duplicate active run exists, skip scheduling and log with reference to existing run. |
| Event Trigger Processor | Use configured Liquid run key template (context exposes `event`, `trigger`, rendered `parameters`, and any `partition.attributes`). If absent, derive from trigger dedupe key; fallback to `event-{eventId}`. Collisions attach the delivery to the existing run and mark it as an idempotent replay. |
| Asset Materializer | Combine asset ID + partition key (`asset-materialize-{assetId}-{partition}`). If conflict, release claim and avoid duplicate enqueue. |
| Admin tools / Runbook scripts | Provide optional `--run-key` flag; default to existing partition key or generated slug. |

All entry points rely on shared helper `normalizeRunKey(input?: string, context: {...})` to maintain consistent rules and to auto-generate safe fallbacks (`wk-{uuid}`) when no meaningful context exists.

## Integration Surfaces
- **API Responses:** Include `runKey` in serialized run payloads. Update OpenAPI spec accordingly.
- **Queues:** Embed `runKey` in job ID (`workflow-run--{runKey}--{uuid}`) when available to aid queue inspection.
- **Workflow Worker Logs:** Add `runKey` to structured log metadata and alerts (`workflow.run.failed`).
- **Event Bus Metadata:** Append `workflowRunKey` field in emitted events for dashboards and consumers.
- **Docker Runner:** Prefer sanitized `runKey` for workspace prefix/container names, falling back to UUID when sanitized key is empty or collides (Ticket 203).
- **Frontend:** Display run key alongside run ID, allow filtering by either, and update live overlays (Ticket 204).

## Rollout Plan
1. **Schema & Helper Landing (Ticket 201 & 202)**
   - Merge migrations and helper utilities behind feature flag (`WORKFLOW_RUN_KEYS_ENABLED`).
   - Deploy to dev/staging; exercise manual runs with explicit keys.
2. **Automation Adoption (Ticket 202)**
   - Enable key derivation in scheduler, triggers, and materializer with flag on.
   - Monitor unique constraint metrics; ensure no spike in conflicts.
3. **Propagation (Ticket 203)**
   - Roll out queue/runner/event updates. Update dashboards to include new field.
4. **UI & Docs (Ticket 204)**
   - Surface keys in frontend, runbooks, and operator docs.
5. **Backfill & Enforcement**
   - Run backfill on historical data once production confidence is established.
   - Optionally migrate API to warn when run key is absent, nudging callers to adopt.

## Observability & Telemetry
- New counter `workflow_run_key_conflicts_total` incremented when duplicates occur.
- Histogram `workflow_run_key_derivation_duration_ms` to monitor helper performance during high-volume triggers.
- Log event `workflow.run.key.missing` when automated path falls back to generated slug, enabling follow-up to improve context.

## Open Questions
- Should automated paths ever override caller-supplied keys? (Current stance: no.)
- Do we need per-tenant prefixes in multi-tenant deployments? (Deferred; add note in RFC once tenancy requirements clarified.)
- Backfill ordering: by newest-first or partition-based? (Operations to confirm preference.)

## Acceptance Criteria
- RFC reviewed and signed off by catalog, frontend, and operations leads.
- Tickets 201-204 reference this document for normalization rules and collision handling.
- Feature flag plan documented and initial telemetry charts defined.
