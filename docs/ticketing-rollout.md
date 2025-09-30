# Ticketing Service Rollout Guide

This guide covers how to run the ticketing service locally, surface the UI, expose MCP tooling, and what to monitor before enabling it for teams.

## Local Development

```bash
# install dependencies (runs UI install automatically)
npm install

# run REST API + MCP server + UI shell
auth_token="local-dev" npm run dev --workspace @apphub/ticketing-service
```

This launches three processes via `concurrently`:

- `dev:server` — Fastify REST service on `http://localhost:4100`
- `dev:mcp` — MCP stdio server reusing the same `tickets/` store
- `dev:ui` — Vite dev server for the dashboard (`http://localhost:5175`)

The REST build embeds the UI: `npm run build --workspace @apphub/ticketing-service` produces `dist/` assets and bundles them with Fastify Static.

## Environment Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `TICKETING_PORT` | `4100` | REST server port. |
| `TICKETING_HOST` | `0.0.0.0` | Bind address for REST server. |
| `TICKETING_TICKETS_DIR` | `tickets/` | Location of ticket YAML files. |
| `TICKETING_ENABLE_WATCHER` | `true` | Disable to skip filesystem polling (e.g., CI). |
| `TICKETING_MCP_ENABLED` | `true` | Fast path to disable MCP server. |
| `TICKETING_MCP_PORT` | `4101` | Not used for stdio transport, but reserved for future sockets. |
| `TICKETING_MCP_TOKENS` | *(empty)* | Comma separated auth tokens for MCP tools. |
| `TICKETING_MCP_ACTOR` | `mcp` | Actor recorded in ticket history when agents omit one. |

For UI/API auth parity, set `TICKETING_MCP_TOKENS` and share the token with agents (`authToken` property).

## MCP Tooling Checklist

1. Start the MCP server (`npm run dev:mcp --workspace @apphub/ticketing-service`).
2. Point your MCP client at `npm run mcp --workspace @apphub/ticketing-service` (see `examples/agents/ticketing.mcp.json`).
3. Call `ticket.list` → confirm a JSON payload is returned and the UI reflects the same board.
4. Call `ticket.updateStatus` with a comment → refresh the UI and verify history/metrics update.

## UI Smoke Validation

- Load `http://localhost:5175` (dev) or `http://localhost:4100` (built bundle).
- Create/edit a ticket via MCP and confirm the kanban board reflects updates within ~5 seconds.
- Open the ticket drawer and verify assignee + comment workflows write to `tickets/*.ticket.yaml`.
- Inspect the dependency graph for cycles and ensure new edges appear on refresh or SSE update.

A minimal Vitest smoke test runs via `npm run test:ui --workspace @apphub/ticketing-service`.

## Metrics & Monitoring

Expose these Fastify metrics to existing Prometheus scraping:

- `ticketing_component_ready{component="store|watcher"}` — readiness gauge.
- `ticketing_tickets_created_total` / `_updated_` / `_deleted_` — MCP + API mutations.
- `ticketing_refresh_total{reason}` — filesystem watcher churn.

Suggested SLO: `HTTP 2xx responses / total >= 99% over 15 minutes` and `watcher readiness = 1` alerting for more than 2 consecutive intervals.

## Deployment Steps

1. Ensure `tickets/` directory is git-versioned on the target environment or configure a shared volume.
2. Deploy the service behind the existing reverse proxy (`/tickets`, `/tickets/dependencies`, `/tickets/events`, `/metrics`).
3. Publish the MCP manifest to agent configuration repositories with the production token.
4. Update onboarding docs to reference the dashboard URL and MCP manifest.
5. Schedule a design review of the UI before announcing GA.

## Rollback

- Stop the ticketing service deployment or remove `/tickets` routes from the proxy.
- Restore manual ticket management from git history (`tickets/*.ticket.yaml`).
- Disable MCP manifests in agent configs to prevent stale tool usage.
