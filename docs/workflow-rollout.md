# Workflow Rollout & Operational Playbook

## Overview
Ticket 005 introduces hardened authentication, secret management, and observability for jobs and workflows. This document captures how to migrate workflow definitions across environments, how to roll back safely, and how to execute a phased rollout with appropriate guardrails.

## Workflow Definition Versioning & Migration
- **Authoring:** Keep workflow definitions in source control alongside the services they orchestrate. Increment the `version` field whenever contract changes (step IDs, parameters, triggers) occur.
- **Promotion Pipeline:**
  1. Develop and lint definitions locally; exercise with inline Redis/SQLite via `npm run test:e2e --workspace @apphub/catalog`.
  2. Promote to staging by applying the same JSON payloads via the secured `/workflows` endpoint, using environment-specific operator tokens.
  3. Store exported definitions (e.g., `GET /workflows/:slug`) as artifacts so production migrations can be audited.
- **Schema Compatibility:** Favor additive changes (new optional parameters, additional steps) to maintain backward compatibility. When breaking changes are unavoidable, deploy new versions under a suffixed slug (`slug-v2`) and migrate consumers before retiring the previous version.

## Rollback Strategy
- **Configuration Snapshots:** Capture workflow definitions and operator token assignments before each deployment (export to versioned JSON).
- **Database Checkpoints:** Utilize point-in-time recovery for PostgreSQL or snapshot the `workflow_definitions` and `workflow_runs` tables prior to major releases.
- **Operational Rollback:**
  - Revert to the previous definition payload by re-submitting the last known-good JSON through `/workflows`.
  - Cancel in-flight runs that reference the problematic definition (`PATCH /workflow-runs/:id` if forced) after capturing diagnostics.
  - Use the audit log (`audit_logs` table) to verify which operator applied the faulty change and coordinate comms.
- **Secret Rotation:** If a secret leak is suspected, rotate entries inside the secret store and re-run affected workflows after confirming audit coverage.

## Phased Rollout Plan
1. **Dev Soak (Day 0-1)**
   - Enable structured logging and metrics locally; verify `GET /metrics` output and audit log entries for manual runs.
   - Populate the secret store with non-production credentials and confirm workflow headers resolve from `source: 'store'` references.
2. **Staging Verification (Day 1-2)**
   - Deploy migrations (ensuring `audit_logs` table exists) and promote token/secret configuration via the new env vars.
   - Run smoke workflows end-to-end; monitor structured logs in the aggregator and confirm workflow failure alerts trigger when thresholds are lowered artificially.
3. **Canary in Production (Day 3)**
   - Assign scoped operator tokens to a limited SRE group.
   - Register a canary workflow definition and trigger manual runs; cap failure threshold at `2` with a short window to validate alert delivery chains.
   - Create dashboards sourced from `/metrics` to visualize baseline success rates.
4. **Ramp-Up (Day 3-5)**
   - Migrate remaining production workflows using staged JSON artifacts.
   - Gradually enable automated triggers; keep a close watch on failure alerts and audit logs for unexpected activity.
5. **General Availability (Day 5+)**
   - Restore default alert thresholds (e.g., `3` failures / `15` minutes).
   - Document the new operational flow for the on-call runbook and schedule periodic secret-access reviews using audit logs.

## Monitoring & SLA Commitments
- **Dashboards:** Track `jobs.failureRate`, `workflows.failureRate`, and step-level latency percentiles derived from `GET /metrics` and workflow run contexts.
- **Alerts:**
  - Workflow failure streak webhook (configurable) feeds PagerDuty/Slack.
  - Optional log-based alerts for unauthorized access attempts (status `missing_token` / `invalid_token` in `audit_logs`).
- **SLA Targets:**
  - 99% of workflow runs complete within 5 minutes.
  - Repeated workflow failure alerts acknowledged within 15 minutes.
  - Secret access audit entries reviewed weekly in regulated environments.

## Rollout Checklist
- [ ] Populate operator token JSON (with scopes) in each environment.
- [ ] Load secrets into the shared store and confirm audit logging for access.
- [ ] Verify migrations applied (`schema_migrations` includes `004_security_observability`).
- [ ] Exercise `/metrics` and ensure dashboards receive data.
- [ ] Trigger intentional workflow failures to validate webhook delivery and structured warning logs.
- [ ] Capture pre- and post-rollout workflow definition exports for recovery.
- [ ] Update on-call documentation with rollback steps and alert runbooks.
