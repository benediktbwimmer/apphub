# Ticket 042: Author Filestore Cutover Runbook & SLOs

## Problem Statement
Once Filestore ships, we need a repeatable plan to onboard services, monitor health, and roll back if issues arise. Without a runbook and SLO definitions, operators risk inconsistent migrations and prolonged outages.

## Goals
- Document a cutover plan covering prerequisites, staging verification, production rollout steps, and rollback procedures for services moving to Filestore-managed paths.
- Define service-level objectives (availability, command success rate, reconciliation lag) and corresponding alert thresholds leveraging existing Prometheus metrics and Redis queue health checks.
- Outline monitoring dashboards (Grafana or similar) and log queries that correlate filestore events with Metastore/Timestore consumers.
- Include checklists for updating IAM policies, rotating tokens, seeding initial metadata, and enabling drift watchers per environment.

## Non-Goals
- Implementing dashboards or alert rules in code—provide configuration templates and guidance.
- Scheduling migrations for specific teams; focus on platform-level instructions.

## Implementation Sketch
1. Create `docs/filestore-cutover.md` (or extend existing docs) with step-by-step instructions, decision matrices, and rollback scenarios.
2. Reference metrics exposed in Tickets 032–039, mapping them to recommended SLOs and alert thresholds.
3. Provide sample Grafana/Looker panels, Redis command checks, and `curl`/CLI snippets operators can run.
4. Review the runbook with operations/oncall stakeholders and capture sign-off.

## Acceptance Criteria
- Runbook published in `docs/` and linked from the main architecture doc, covering staging/production pathways and failure drills.
- SLO targets agreed upon by platform + reliability teams and documented alongside monitoring recommendations.
- Operators confirm (via checklist sign-off) that the runbook supports dry-run cutovers in staging without manual filesystem edits.
- Rollback steps include disabling watchers, draining BullMQ queues, and reverting to manual filesystem access if necessary.
