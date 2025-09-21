# Ticket 009: Migrate Built-In Jobs to Dynamic Bundles

## Summary
Transition current hardcoded job handlers (ingestion, build, filesystem, etc.) into independently versioned bundles delivered through the new registry and runtime.

## Problem Statement
Legacy handlers must be decoupled without disrupting existing workflows. We need a staged migration that registers bundle equivalents, ensures backward compatibility, and deprecates inline handlers once confidence is high.

## Scope & Requirements
- Package existing handlers as bundles with manifests, publish initial versions to the registry, and register definitions pointing to these bundles.
- Implement fallback logic during migration: worker tries registry first, then legacy handler if bundle unavailable (with instrumentation to detect fallback usage).
- Update database records / API responses to include registry reference (slug@version) for each job definition.
- Plan rollout: enable bundles in staging, monitor, then flip feature flag in production. Provide rollback procedure to revert to legacy handlers if issues arise.
- Document migration checklist for future built-in jobs.

## Non-Goals
- Creating new job functionality; focus is parity with existing handlers.
- Long-term decommission of legacy code (will happen after successful rollout, tracked separately if needed).

## Acceptance Criteria
- All built-in jobs have published bundle counterparts and run through the sandbox runtime in staging.
- Telemetry shows zero fallback executions after migration window; legacy handlers can be flagged for removal.
- Feature flag or config toggle exists to revert to inline handlers quickly.
- Runbooks outline deployment steps and rollback instructions.

## Dependencies
- Tickets 006–008 delivering registry, tooling, and runtime.
- Observability baseline from prior hardening ticket.

## Testing Notes
- Regression tests comparing legacy vs bundled handler outputs.
- Monitoring dashboards validating no increase in job run failures post-migration.
