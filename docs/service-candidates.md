# Service Expansion Candidates

This note captures potential services that could complement the existing AppHub stack. Each idea includes the motivation, how it would integrate with today’s platform, and open questions that must be validated before we invest in a new boundary.

## Notification Relay Service
- **Why**: Workflow runs, asset materialization, and catalog events increasingly need Slack, email, or webhook notifications. Shipping this from catalog mixes delivery retries with core orchestration.
- **What**: Consume the shared event bus (`workflow.event.received`, `asset.produced`, `metastore.record.*`) and expose a policy layer that maps envelopes to notification channels. Provide per-channel rate limits, batching, templating, and idempotent retries.
- **Integration**:
  - Ingest events via existing BullMQ queues or `/internal/events/publish`.
  - Surface REST endpoints for rule management and delivery audits.
  - Emit delivery metrics that Timestore can ingest for reporting.
- **Open Questions**: Which channels are must-have on day one? Do we require message signing for external webhooks? How do we deduplicate alerts with existing observability tools?

## Managed Secrets Service
- **Why**: Catalog currently resolves secrets inline with pluggable stores, but rotations, access policies, and auditing live inside the monolith.
- **What**: A dedicated API that brokers short-lived credentials, enforces scope-based access, and records the full audit trail. Could back secret material with external vaults while presenting a uniform interface to jobs and workflows.
- **Integration**: Replace the catalog `resolveSecret` helper with a lightweight client that requests scoped tokens. Emit access logs to the event bus for compliance workflows.
- **Open Questions**: Do we need envelope encryption at rest beyond what vault integrations provide? Can we enforce per-tenant quotas or per-step policies without adding latency to job startup?

## Search & Recommendation API
- **Why**: Catalog shoulders ingestion, orchestration, and search. Future ranking, personalization, or vector-based discovery will outgrow the Postgres FTS tables currently embedded in catalog.
- **What**: Extract indexing, scoring, and search persistence into its own service. Allow experimentation with alternative backends (Meilisearch, Vespa, pgvector) without coupling rollouts to catalog deployments.
- **Integration**: Catalog remains the system of record for metadata but publishes repository and tag snapshots to the search service. Frontend switches to querying the new API for search/autocomplete requests.
- **Open Questions**: What SLA do we need for search freshness versus build throughput? Can we reuse the event bus or do we need dedicated CDC feeds for high-volume updates?

## Identity & Policy Service
- **Why**: OAuth/OIDC rollout and API-key management live inside catalog today. As scope granularity grows, we risk duplicated auth logic across services.
- **What**: Centralize user identities, role assignment, and scope enforcement. Issue JWTs or opaque tokens consumable by catalog, metastore, filestore, and timestore. Manage API-key lifecycle, rotation reminders, and audit events.
- **Integration**: Expose an authorization gRPC/REST endpoint. Catalog delegates scope checks, while other services validate tokens against the shared issuer.
- **Open Questions**: Do we maintain backwards compatibility for operator tokens, or start with a migration? How do we align with external SSO/IdP integrations?

## Observability Aggregator
- **Why**: Metrics today are emitted per service, but operators need a unified view of workflow retries, queue depths, and dataset health. Catalog exposes many of these endpoints; consolidating them improves alerting and reporting.
- **What**: A service that ingests Prometheus metrics, workflow events, and Timestore summaries, then ships dashboards, alert policies, and historical analytics.
- **Integration**: Subscribe to the event bus, scrape service metrics, and push summarized datasets into Timestore for long-term retention. Provide APIs that the frontend can call for unified health views.
- **Open Questions**: Do we prioritize real-time alerting or historical trends? Which existing metrics should move versus remain service-owned?

## Next Steps
1. Socialize these candidates with stakeholders (catalog, operations, security) to validate demand and narrow priorities.
2. Instrument current bottlenecks—notification latency, secret fetch volume, search request load—to build a data-driven case for any extraction.
3. For the highest priority idea, draft interface contracts on top of existing modules (event bus publisher, secret helper) so we can prototype without immediate data migrations.
