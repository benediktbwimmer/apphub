# Ticket 045: Timestore Query Partition Filtering Improvements

## Problem Statement
`listPartitionsForQuery` only supports exact string matches on partition keys, so timestore pulls every partition whose key loosely matches the requested range. Large datasets with numeric or temporal partition keys suffer from excessive DuckDB ATTACH operations and longer query times because filtering happens after attachment.

## Goals
- Extend partition filtering to support numeric, temporal, and multi-value predicates that can be translated into SQL WHERE clauses for Postgres.
- Allow clients to pass richer filter structures (equality, `IN`, simple range comparisons) while maintaining backward compatibility for existing requests.
- Reduce the number of partitions timestore attaches for common query patterns, improving query latency and resource usage.

## Non-Goals
- Implementing an arbitrary predicate language; focus on a controlled subset that maps cleanly to indexed columns.
- Requiring clients to express filters in raw SQL.

## Implementation Sketch
1. Expand `queryRequestSchema` to accept a more expressive `filters` payload (e.g., typed operators per key) and convert legacy payloads automatically.
2. Update `listPartitionsForQuery` to generate WHERE clauses that leverage partition_key JSONB operators or persisted column projections so Postgres can prune partitions.
3. Adjust the planner/executor to handle cases where no partitions match (short-circuit query plan) and verify remote partition counting still works.
4. Add tests covering numeric and timestamp filters, multi-value filters, and improper combinations that should be rejected with validation errors.
5. Benchmark representative queries before/after to confirm the number of attached partitions drops and latency improves.

## Deliverables
- Enhanced filter schema and validation available to both service and frontend clients.
- Query planner changes that prune partitions at the database layer when filters are supplied.
- Test coverage demonstrating correct partition selection across string, numeric, and temporal keys.
- Performance notes illustrating the improvement gained from the new filtering capabilities.
