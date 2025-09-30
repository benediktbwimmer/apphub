# Ticketing Schema and Storage Model

This document describes the canonical data model and persistence layout used by the ticketing service. It is the contract shared by the MCP server, REST API, file store, and UI.

## Ticket Files
- Location: `tickets/<ticket-id>.ticket.yaml`
- Format: YAML document validated by `@apphub/ticketing` schemas.
- All fields except `dependents` are persisted. `dependents` is derived during index builds.

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
The store keeps two JSON artifacts for fast lookups and UIs:

- `tickets/index.json` — array of summarized tickets with `dependents` populated and timestamps for cache busting.
- `tickets/dependencies.json` — adjacency list representing the dependency graph.

These files include a `generatedAt` timestamp and are regenerated after each mutation.

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
3. Artifacts (`index.json`, `dependencies.json`) are validated against their own schemas before writing.
4. YAML ticket files are parsed and validated on every load; malformed files raise `TicketValidationError`.

## File Naming Conventions
- Ticket filenames must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`.
- Default IDs derive from a slugified title. Collisions append `-1`, `-2`, etc.
- Manual IDs supplied in new ticket payloads are treated as authoritative; duplicates throw.

## Extension Points
- `metadata` and `fields` dictionaries allow the UI and agents to introduce new data without schema migrations.
- Additional activity `action` kinds can be added in `ticketActivityActionSchema` when workflows expand.

Keep this document updated if we adjust the schema or persistence rules so external tooling remains compatible.
