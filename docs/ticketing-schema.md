# Ticketing Schema and Storage Model

This document describes the canonical data model and persistence layout used by the ticketing service. It is the contract shared by the MCP server, REST API, SQLite backend, and UI.

## Storage Layout
- Location: `${TICKETING_TICKETS_DIR}/tickets.db` (defaults to `./tickets/tickets.db`).
- Engine: `better-sqlite3` opened in WAL mode.
- Table schema:
  - `tickets(id TEXT PRIMARY KEY)`
  - `data TEXT` — JSON blob validated by `@apphub/ticketing` schemas.
  - `revision INTEGER` — optimistic locking counter.
  - `created_at TEXT`, `updated_at TEXT` — ISO timestamps mirrored in the JSON payload.
- All fields except `dependents` are persisted. `dependents` is derived during artifact rebuilds.

### Ticket Fields
| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique slug; generated from title if omitted. |
| `title` | string | Required human-readable summary. |
| `description` | string | Markdown-friendly detail. |
| `status` | enum | One of `backlog`, `in_progress`, `blocked`, `review`, `done`, `archived`. |
| `priority` | enum | `low`, `medium`, `high`, `critical`. Defaults to `medium`. |
| `assignees` | string[] | GitHub-style handles or emails; deduplicated. |
| `tags` | string[] | Free-form labels; deduplicated. |
| `dependencies` | string[] | Ticket IDs that must complete first. Self-references are stripped. |
| `dependents` | string[] | Derived list maintained in index (not written to YAML). |
| `createdAt`/`updatedAt` | ISO-8601 string | Auto-updated on writes. |
| `dueAt` | ISO-8601 string | Optional milestone deadline. |
| `history` | Activity[] | Chronological log of actions. |
| `links` | Link[] | External references (docs, issues, PRs, designs). |
| `metadata` | record | Arbitrary structured data for integrations. |
| `fields` | record | Extensible custom fields. |
| `revision` | integer | Monotonic version, used for optimistic locking. |

### Activity Entries
```
type Activity = {
  id: string;           // nanoid(12)
  actor: string;        // Required human or automation identifier
  action: 'created' | 'updated' | 'status.change' | 'comment' | 'dependency.change' | 'assignment' | 'field.change';
  at: string;           // ISO timestamp
  message?: string;
  payload?: Record<string, unknown>;
}
```

## Derived Artifacts
The store maintains two in-memory artifacts for fast lookups and UIs:

- Ticket index — array of summarized tickets with `dependents` populated and timestamps for cache busting.
- Dependency graph — adjacency list representing the dependency graph.

They are regenerated after each mutation or watcher refresh and exposed through `TicketStore#getIndex()` and `TicketStore#getDependencyGraph()`. No additional files are written to disk.

## Concurrency and Revisions
- Mutations accept an optional `expectedRevision`. Conflicts raise `TicketConflictError` before touching the filesystem.
- Revision increments on any field change or comment addition.
- Actor metadata defaults to `system` but callers should supply a meaningful `actor` for history tracking.

## JSON Schemas
Schema generation lives under `packages/ticketing/schemas`:
- `ticket.json`
- `ticket.new.json`
- `ticket.update.json`
- `ticket.index.json`
- `ticket.dependencies.json`

Run `npm run generate:schema --workspace @apphub/ticketing` to refresh them after schema changes.

## Validation Pipeline
1. Incoming payloads are parsed with Zod schemas in `packages/ticketing/src/schema.ts`.
2. Before persisting, objects are normalized (dedupe arrays, trim whitespace, drop self references).
3. Artifacts (index and dependency graph) are validated against their own schemas before being published to callers.
4. Stored tickets are parsed from JSON and validated on every load; malformed rows raise `TicketValidationError`.

## Ticket Identifier Rules
- Ticket IDs must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`.
- Default IDs derive from a slugified title. Collisions append `-1`, `-2`, etc.
- Manual IDs supplied in new ticket payloads are treated as authoritative; duplicates throw.

## Extension Points
- `metadata` and `fields` dictionaries allow the UI and agents to introduce new data without schema migrations.
- Additional activity `action` kinds can be added in `ticketActivityActionSchema` when workflows expand.

Keep this document updated if we adjust the schema or persistence rules so external tooling remains compatible.
