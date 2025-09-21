# Ticket 003: Service Step Integration

## Summary
Extend workflow orchestration with the ability to call registered services as workflow steps, applying health-aware retries and standard invocation patterns.

## Problem Statement
Workflows must interleave run-to-completion jobs with live services. We need a generalized service step execution layer that consults the service registry, invokes endpoints securely, and cooperates with the orchestrator for retries and failure handling.

## Scope & Requirements
- Enhance workflow step schema and orchestrator logic to support `service` step types referencing registered services.
- Implement service invocation helpers (HTTP/gRPC based on service metadata) that respect timeout/retry configuration and record responses into workflow context storage.
- Integrate service health checks so the orchestrator can skip or delay steps when dependent services are unhealthy.
- Provide configuration for authentication secrets/tokens required to call services, leveraging existing secret storage placeholders.
- Update event payloads and run records to capture service invocation metadata (latency, status code, error details).

## Non-Goals
- UI visualization upgrades beyond displaying service step status in existing views.
- Full secret manager integration (stub interfaces acceptable but must not leak credentials).

## Acceptance Criteria
- A workflow combining job and service steps executes successfully, retrying service calls per policy and halting when thresholds are exceeded.
- Service invocation logs, metrics, and responses are persisted and visible via API endpoints.
- Health-aware scheduling prevents immediate invocation when services are marked degraded in the registry.
- Security review confirms sensitive tokens are not stored in plaintext logs.

## Dependencies
- Ticket 002 (Workflow MVP Orchestrator) for baseline workflow execution.

## Testing Notes
- Add integration tests simulating success/failure responses from services, asserting retries and context propagation.
- Verify workflow events show service step metadata without exposing secrets.
