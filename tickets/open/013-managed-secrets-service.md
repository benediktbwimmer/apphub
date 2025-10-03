# Extract secrets management into dedicated service

## Context
- Core loads secrets from inline JSON/environment (`services/core/src/secretStore.ts:1`) with no rotation or auditing.
- Docs (`docs/service-candidates.md:14`) call for a managed secrets boundary but the monolith still resolves credentials inline.
- Workers and modules increasingly need scoped, short-lived secrets, especially for external runtimes.

## Impact
- Rotating credentials requires redeploying core or editing env files, creating downtime risk.
- No central audit trail exists for secret access, complicating compliance and incident investigations.
- Sharing secrets across services duplicates logic and increases the chance of misconfiguration.

## Proposed direction
1. Design a secrets service under `services/` that brokers secret material via REST + short-lived tokens.
2. Support pluggable backends (env, file, Vault) while exposing a consistent API for issue/refresh/revoke operations.
3. Replace `getSecretFromStore` usage in core/workers with a lightweight client library in `packages/shared`.
4. Emit access logs to the event bus for auditing and integrate with the planned notification relay for anomaly alerts.
5. Document migration steps, including toggles to fall back to inline mode during rollout.

## Acceptance criteria
- A new secrets service issues scoped credentials and records audit events for every access.
- Core and workers consume secrets via the client library, removing direct env/json parsing from hot paths.
- Rotation workflows (manual or automated) can refresh secrets without restarting core services.
- Documentation covers configuration, migration, and fallback strategies.
