# Standalone notification relay service

## Context
- `docs/service-candidates.md:5` outlines a notification relay service but no implementation exists today.
- Core currently emits rich events (see `services/core/src/events.ts:59`) yet delivery to Slack/email/webhooks is ad hoc or absent.
- Operators need policy-driven fan-out and durable retries without loading more responsibility onto the core workers.

## Impact
- Notification logic glued into core risks retry storms blocking orchestration work.
- Different teams cannot self-serve alert rules, so workflow/asset incidents go unnoticed or rely on manual log checks.
- External destinations require signing, rate limits, and auditing that are hard to bolt onto the existing monolith.

## Proposed direction
1. Introduce a new workspace under `services/` (e.g. `notification-relay`) with Fastify API + BullMQ worker skeleton.
2. Subscribe to the shared event bus (`workflow.*`, `asset.*`, `metastore.record.*`) and persist delivery policies in Postgres via `packages/shared` schemas.
3. Ship first-class delivery adapters for Slack webhooks, generic HTTPS webhooks, and email (stub provider acceptable to start).
4. Expose CRUD endpoints for policies plus delivery audit queries; surface Prometheus metrics for success/failure counts and retry lag.
5. Add frontend integration to configure policies and link notifications to workflow runs, starting with a minimal settings page.

## Acceptance criteria
- A new notification relay service consumes core events and executes policies with retry + dead-letter handling.
- Operators can manage notification rules via API and UI, including channel targets and filters.
- Delivery metrics and audit history are queryable (API + Prometheus) so incidents can be traced end-to-end.
- Core delegates notification fan-out to the service and no longer embeds channel-specific logic.
