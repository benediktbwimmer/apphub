# Ticket 202: Accept and Derive Run Keys Across Launch Paths

## Problem
Even with schema support, run keys will not populate unless every workflow entrypoint can accept or derive them. Manual API calls, scheduler launches, event triggers, asset materializer claims, and admin retry tooling currently assume the system generates a UUID. We need consistent behavior to avoid mismatched semantics or silent collisions.

## Proposal
- Extend `/workflows/:slug/run` request schema to accept optional `runKey`, validate it against RFC rules, and bubble conflicts with clear errors.
- Update scheduler, event trigger processor, asset materializer worker, and manual/admin utilities to derive deterministic keys when callers do not provide one (e.g., time window, dedupe key, `assetId+partition`).
- Ensure retries and resumptions reuse the original key; guard against unintentional new keys during requeue.
- Propagate run key to workflow orchestration layer so history events, audits, and logs include both identifiers.
- Add integration/contract tests covering each entrypoint and collision handling.

## Deliverables
- API schema updates and typed client adjustments.
- Implementation changes for all run creation sites with shared helper for normalization + fallback.
- Tests in scheduler, trigger, and asset materializer suites verifying key derivation and uniqueness enforcement.
- Documentation for operators describing how to supply run keys manually and interpret collisions.

## Risks & Mitigations
- **Inconsistent derivation:** Centralize normalization helper and reference RFC guidance to prevent drift; add lint rule or shared utility to enforce usage.
- **Breaking existing clients:** Keep `runKey` optional with backward-compatible defaults; surface friendly validation errors when supplied values fail.
- **Race conditions on retries:** Ensure dedupe logic reuses stored key before attempting re-enqueue; add regression tests for heartbeat recovery paths.
