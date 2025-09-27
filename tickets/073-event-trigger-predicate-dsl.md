# Ticket 073: Expand Event Trigger Predicate DSL

## Problem Statement
Event triggers currently support only `exists`, equality, and inclusion operators. Operators frequently need numeric comparisons, regex checks, and containment logic, leading to brittle job-side validation or multiple redundant triggers. Enhancing the predicate DSL would simplify trigger authoring and reduce downstream guard rails.

## Goals
- Introduce additional operators (e.g., `gt`, `gte`, `lt`, `lte`, `regex`, `contains`) with server-side enforcement and validation.
- Update schema validation (`eventTriggerValidation.ts`) and database serialization to support the new operators safely.
- Document operand types and case-sensitivity rules to avoid ambiguity.

## Non-Goals
- Adding arbitrary user-defined functions or scripting inside predicates.
- Implementing complex boolean expressions beyond `AND` semantics (defer to a future ticket if needed).

## Implementation Sketch
1. Extend `WorkflowEventTriggerPredicate` types and row mappers to handle new operators, including operand schemas.
2. Update `eventTriggerProcessor` to evaluate the new operators using JSONPath results with proper type coercion.
3. Enhance validation to ensure operands match operator expectations (numeric, string, array) and guard against expensive regexes.
4. Provide documentation and migration notes describing the new operator syntax.
5. Add unit and integration tests covering positive/negative matches for each new operator.

## Acceptance Criteria
- API accepts the new operators and rejects invalid combinations with descriptive errors.
- Runtime evaluation correctly matches events according to the expanded DSL, with unit tests verifying behavior.
- Documentation (docs/workflows.md or dedicated page) lists supported operators and examples.
- Existing predicates continue to function without change.
