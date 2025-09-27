# Ticket 072: Pre-Validate Workflow Trigger Templates

## Problem Statement
Workflow event triggers accept Liquid templates for parameters and idempotency keys, but validation only happens at runtime inside `eventTriggerProcessor`. Mis-typed variables or syntax errors silently fail during delivery, causing skipped runs or unexpected defaults without early feedback. Operators need compile-time validation when creating/updating triggers.

## Goals
- Compile Liquid templates during trigger create/update requests and surface detailed errors in API/CLI/UI responses.
- Reject triggers whose templates reference undefined context (e.g., `event.payload` fields that do not exist in sample events when provided).
- Add unit coverage to ensure template validation catches syntax errors and unknown filters.

## Non-Goals
- Automatic inference of event schema or template auto-completion (handled by the event schema explorer ticket).
- Introducing a new templating language.

## Implementation Sketch
1. Extract a reusable Liquid compiler helper that parses templates with strict options and returns diagnostics.
2. Invoke the helper inside trigger validation (`eventTriggerValidation.ts`) for parameter templates and idempotency expressions; include context variables (`event`, `trigger`, `now`).
3. Extend the trigger API to optionally accept a sample envelope for context validation and provide warnings when fields are missing.
4. Update frontend and CLI flows to display compile errors inline.
5. Write tests covering syntax failures, undefined filters, and success paths.

## Acceptance Criteria
- Trigger creation/update fails fast when templates contain Liquid syntax errors or reference invalid context.
- API responses list problematic fields with actionable error messages that the frontend renders.
- Existing valid templates continue to pass without regression.
- Test suite verifies validation logic and the helper behaves deterministically.
