# Ticketing MCP Server

The ticketing service ships an MCP-compatible interface so local agents can create, update, and inspect tickets while sharing the same SQLite-backed store as the HTTP API.

## Getting Started

```bash
# From the monorepo root
TICKETING_MCP_TOKENS="local-token" npm run dev --workspace @apphub/ticketing-service # or npm run mcp ...
```

The server uses stdio transport by default, making it easy to plug into agents such as Claude Code or the Codex CLI. The sample manifest in `examples/agents/ticketing.mcp.json` configures `npm run mcp --workspace @apphub/ticketing-service` as the launch command for compatible clients.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `TICKETING_MCP_ENABLED` | `true` | Disable to skip loading the MCP server in automation contexts. |
| `TICKETING_MCP_TOKENS` | *(empty)* | Comma-separated list of bearer tokens required by tool invocations. Leave empty to allow unauthenticated access. |
| `TICKETING_MCP_ACTOR` | `mcp` | Default actor recorded in ticket history when callers do not override `actor`. |
| `TICKETING_MCP_TICKETS_DIR` | `tickets/` | Override the ticket data directory (defaults to the same path as the HTTP service). |

The MCP server reuses the ticket store directly, so all changes immediately appear in the HTTP API and derived artifacts.

## Tools

| Tool | Purpose | Input Schema |
| --- | --- | --- |
| `ticket_create` | Create a ticket from the shared schema. | `{ title, description, id?, status?, priority?, assignees?, tags?, dependencies?, dueAt?, actor?, message?, authToken? }` |
| `ticket_update_status` | Change a ticket status with optional comment. | `{ id, status, comment?, expectedRevision?, actor?, authToken? }` |
| `ticket_add_dependency` | Append a dependency, rejecting self-references. | `{ id, dependencyId, expectedRevision?, actor?, authToken? }` |
| `ticket_comment` | Add a history comment without mutating other fields. | `{ id, comment, expectedRevision?, actor?, authToken? }` |
| `ticket_assign` | Replace or merge assignees. | `{ id, assignees[], mode?, expectedRevision?, actor?, authToken? }` |
| `ticket_list` | List tickets with filters. | `{ status?, tags?, assignee?, authToken? }` |
| `ticket_history` | Fetch the activity log. | `{ id, authToken? }` |

Status filters accept canonical names (`backlog`, `done`, etc.) or the aliases `open` (backlog, in_progress, blocked, review) and `closed` (done, archived).

All tool responses include a JSON payload plus a short text summary, which most MCP clients surface to the user. When `TICKETING_MCP_TOKENS` is set, callers must pass the matching token in `authToken`.

## Development Notes

- The MCP server relies on the shared `@apphub/ticketing` package for validation and database access, ensuring parity with the HTTP service.
- Because commands run over stdio, avoid writing to stdout in custom scripts. Diagnostics are emitted on stderr.
- Integration tests under `services/ticketing/tests/mcp.test.ts` exercise the handlers without spinning up a transport.

## Integration Checklist

1. Set `TICKETING_MCP_TOKENS` in a local `.env.local` or agent manifest.
2. Configure your MCP-capable agent to run `npm run mcp --workspace @apphub/ticketing-service` from the repo root.
3. Confirm that `ticket_list` returns data and `ticket_create` persists new rows in `tickets.db` (inspect with `sqlite3` if needed).

> Note: Advanced fields such as links, metadata, or seed history are currently omitted from the MCP contract to satisfy Codex CLI parsing quirks. The HTTP API continues to support these fields.
4. Coordinate token distribution with teammates before enabling in shared environments.
