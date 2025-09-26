# Ticket 026: Timestore Query Ergonomics & Aggregation Expansion

## Problem Statement
Consumers querying sparse or lightly populated ranges receive hard errors when no partitions match, forcing defensive client logic and hurting dashboard UX. Additionally, the downsampling API only supports `avg|min|max|sum`, limiting analytical flexibility for percentile, count, or custom rollups. The service needs friendlier defaults and richer aggregation support to be useful for real-world observability dashboards.

## Goals
- Return empty result sets (200 OK) when no partitions overlap the requested window, with metadata indicating the query executed successfully.
- Expand the aggregation vocabulary to include at least `count`, `count_distinct`, `median/percentile`, and simple math expressions when supported by DuckDB.
- Provide clear validation errors when unsupported aggregations or malformed expressions are submitted.
- Document the new behaviors and update SDK examples to handle empty ranges gracefully.

## Non-Goals
- Implementing full SQL passthrough; continue relying on the structured query schema.
- Supporting arbitrary user-defined functions during this iteration.

## Implementation Sketch
1. Update `buildQueryPlan` to treat empty partition sets as a valid outcome, short-circuiting execution with an empty `QueryResponse`.
2. Extend the Zod schemas to accept the new aggregation functions and any required parameters (e.g., percentile value) with sensible defaults.
3. Enhance `buildDownsamplePlan`/`executeQueryPlan` to translate the new functions into correct DuckDB expressions, adding safety against SQL injection.
4. Adjust tests to cover empty range responses, the new aggregation combos, and validation failures.
5. Refresh API docs and the timestore README with examples demonstrating empty responses and expanded aggregations.

## Deliverables
- Updated query planner/executor returning empty results instead of throwing for sparse ranges.
- Broadened aggregation support with input validation and test coverage.
- Documentation and examples reflecting the new query ergonomics.
