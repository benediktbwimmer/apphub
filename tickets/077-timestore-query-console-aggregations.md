# Ticket 077: Timestore Query Console Aggregations & Column Picker

## Problem Statement
The query console only supports a single aggregation definition and requires users to manually type column lists. The backend, however, accepts multiple aggregations and already knows dataset schemas, so the UI is leaving a lot of ergonomics untapped.

## Goals
- Allow users to add multiple aggregation rows (with aliases, percentile options, etc.) when downsampling queries.
- Provide schema-aware selectors for timestamp, value columns, and projection lists by reusing metadata from the manifest/schema API.
- Improve validation and messaging so malformed aggregation inputs are caught client-side before hitting the API.

## Non-Goals
- Building a full visual query builder; the console should remain a lightweight form over the existing API.
- Implementing persisted query templates (handled separately by SQL editor).

## Implementation Sketch
1. Fetch dataset schema metadata (columns, types) and expose it to the query console component via the new shared data layer.
2. Replace freeform text inputs with combo-boxes or typeahead components that list available columns, defaulting to the manifest timestamp column.
3. Implement a dynamic aggregation list UI supporting add/remove, type selection, alias entry, and percentile validation.
4. Update request payload generation to emit the richer aggregation array while maintaining compatibility with the existing API.
5. Add component/unit tests around validation (e.g., missing columns, invalid percentile) and ensure the UI surfaces backend errors gracefully.

## Deliverables
- Enhanced query console supporting multiple downsample aggregations with schema-aware column selection.
- Validation and UX improvements that prevent malformed requests and guide users toward valid configurations.
- Automated tests covering the new aggregation editor interactions and payload generation.
