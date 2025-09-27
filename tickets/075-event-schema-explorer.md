# Ticket 075: Build Event Schema Explorer for Trigger Authoring

## Problem Statement
Authoring event triggers requires operators to manually inspect recent envelopes and handcraft JSONPath predicates and Liquid templates. The current UI offers an event sample drawer but lacks tooling to suggest predicates or preview rendered parameters, slowing adoption and increasing mistakes.

## Goals
- Introduce an event schema explorer that pulls samples from `/admin/events` and highlights available fields, types, and example values.
- Allow operators to generate JSONPath predicates and Liquid template snippets directly from selected fields.
- Integrate the explorer with the trigger form so suggestions can be inserted and previewed before saving.

## Non-Goals
- Providing full event analytics dashboards or cross-service correlation views.
- Guaranteeing schema stability; the explorer operates on sampled data only.

## Implementation Sketch
1. Extend the admin events API if necessary to return sample payload metadata or inline field statistics.
2. Build frontend components for field browsing, predicate snippet generation, and preview rendering (leveraging existing `EventSampleDrawer`).
3. Wire the explorer into the create/update trigger modal, enabling one-click insertion of generated predicates/templates.
4. Validate generated JSONPath expressions and Liquid snippets before insertion, surfacing errors inline.
5. Add UI tests covering sample selection, snippet generation, and integration with the trigger form.

## Acceptance Criteria
- Operators can browse recent events, select fields, and generate predicate/template snippets without leaving the trigger modal.
- Generated snippets validate successfully and pre-populate trigger forms.
- Tests cover explorer interactions and guard against invalid snippet output.
- Documentation updates explain how to use the explorer during trigger authoring.
