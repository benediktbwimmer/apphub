# Ticket 113: Harden Docker Runtime Configuration and Security

## Problem
Running arbitrary containers introduces security concerns: image provenance, network access, mount scope, and secret injection must be controlled. Without rigorous configuration, Docker jobs could pull untrusted images, exfiltrate data, or access host resources unexpectedly.

## Proposal
- Introduce service-level configuration for Docker job execution: image allow/deny lists, default workspace root, maximum mount size, optional GPU enablement, and network isolation toggles.
- Enforce metadata validation against these policies before execution (e.g. reject images outside approved registries).
- Restrict mounts to per-run workspace directories; inputs mount read-only, outputs write-only.
- Add environment/secrets handling that only allows variables resolved via `context.resolveSecret`, preventing inline secret definitions in metadata.
- Document operational guidance: how to configure the feature, required daemon permissions, and recommended host hardening (e.g. rootless Docker or dedicated worker nodes).

## Deliverables
- Configuration schema updates with defaults and runtime validation (fail-fast on misconfiguration).
- Runtime checks in the Docker runner to enforce allowlists, mount scope, and network restrictions.
- Extended metadata validation errors when policies are violated.
- Documentation in `docs/jobs/docker-runtime.md` (or similar) covering security considerations and deployment checklists.

## Risks & Mitigations
- **Policy drift:** Centralize configuration in one module and add unit tests to catch regression when new fields appear.
- **Operator misconfiguration:** Provide sensible defaults and clear error messages to guide correct setup.
- **Secrets exposure:** Audit logs to avoid printing secret values; add sanitization before writing to job context/metrics.
