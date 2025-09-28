# Ticket 141 – Metastore Explorer Schema-Aware Metadata Editor

## Summary
Transform the metadata editor into a schema-aware experience that fetches definitions by `schemaHash`, renders structured forms with validation, and highlights unknown or deprecated fields before saving.

## Motivation
Editing raw JSON is intimidating and error-prone, especially for large documents. Schema-aware forms can guide operators through required fields, type checks, and context-specific help, reducing mistakes and improving data quality.

## Scope
- When a record exposes `schemaHash`, request schema details via Ticket 140 and render a dynamic form (field groups, types, constraints, descriptions).
- Provide inline validation with friendly error messages before invoking upsert/patch, including warnings for extra fields not defined in the schema.
- Allow toggling to raw JSON mode for advanced edits; sync changes between form and JSON view while preserving unknown fields with clear badges.
- Surface schema documentation links and last updated timestamps; handle missing schema gracefully with a helpful hint.
- Add tests covering schema fetch states, form validation, toggling between form/JSON modes, and submission payloads.

## Acceptance Criteria
- Records with a recognized schema render structured forms; submissions respect schema validation and highlight violations before API calls.
- Raw JSON mode remains available and warns when diverging from schema expectations.
- UX gracefully handles missing or outdated schemas (fallback to previous JSON editor with notice).
- Vitest/UI tests verify form rendering, validation, and mode switching.

## Dependencies / Notes
- Depends on Ticket 140 for schema retrieval.
- Collaborate with design on form layout and validation patterns; consider reusing existing form components.
