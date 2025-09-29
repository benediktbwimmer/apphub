# Ticket 200: Define Human-Readable Workflow Run Keys

## Problem
Workflow runs only expose opaque UUID identifiers today. Operators and downstream automations cannot correlate runs to partition keys, trigger dedupe keys, or schedule windows without digging into run metadata. We want Temporal-style run keys that are human-readable and collision-controlled, but we lack defined semantics, identifier format, or rollout guidance.

## Proposal
- Draft an RFC covering identifier goals, naming rules, and lifecycle (creation, reuse, collision policy, retention).
- Inventory all run entrypoints (manual API, scheduler, event triggers, asset materializer, admin tooling) and document how each will surface or derive run keys.
- Specify database changes (new column, uniqueness constraints) and compatibility strategy (dual identifiers, backfill).
- Outline integration updates for queues, job runners, telemetry, and UI so run keys become first-class without breaking existing UUID references.
- Capture rollout plan: feature flag, backfill ordering, metrics to monitor, and comms to operations.

## Deliverables
- RFC published under `docs/` with clear identifier format and examples.
- Stakeholder review sign-off from catalog, frontend, and operations.
- Checklist of affected systems with required updates and owners.
- Proposed timeline and gating metrics for rollout.

## Risks & Mitigations
- **Ambiguous ownership:** Engage service owners during RFC review to confirm derivation logic; include explicit responsibilities in the checklist.
- **Overly strict naming rules:** Define validation with fallback to generated keys to avoid blocking triggers; capture this as a requirement in the RFC.
- **Migration churn:** Ensure the rollout plan includes staged migration steps and telemetry so downstream consumers are not surprised.
