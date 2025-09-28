# Ticket 083: Durable Retry Program Overview

## Context
AppHub needs Temporal-like durability for event triggers and workflow orchestration. Work was previously captured in a single ticket but covers multiple subsystems. This overview ticket serves as the epic, links the component tickets, and tracks rollout coordination.

## Sub-Tickets
1. **Ticket 083a – Durable Retry Foundations** (new schema/backoff primitives)
2. **Ticket 084 – Event Ingress Durable Retries**
3. **Ticket 085 – Trigger Delivery Retry Pipeline**
4. **Ticket 086 – Workflow Step Durable Retries**
5. **Ticket 087 – Retry Operations UI & Observability**

Each ticket delivers an incremental capability; combined they produce the fully durable retry system.

## Rollout Checklist
- [ ] Schema migration applied in staging & production (Ticket 083a)
- [ ] Event ingress worker running with durable retries (Ticket 084)
- [ ] Trigger retry pipeline enabled behind feature flag (Ticket 085)
- [ ] Workflow retry orchestration live (Ticket 086)
- [ ] UI/observability updates deployed (Ticket 087)

## Coordination Notes
- Ensure increments are gated via feature flags to allow staged rollout.
- Update runbooks and on-call docs once each phase is deployed.
- QA plan: incremental validation following each ticket, plus full-stack soak once everything is on.
