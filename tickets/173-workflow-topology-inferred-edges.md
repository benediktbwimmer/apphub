# Ticket 173: Workflow Topology Inferred Edges

## Problem Statement
Sampled producer data exists but the topology graph still lacks edges between workflow steps and runtime event sources. Operators need to see observed relationships in the UI, distinct from declarative trigger edges, to reason about runtime behavior.

## Goals
- Extend the topology builder to read sampled producer rows and emit `eventSource` nodes plus `step → eventSource` edges marked as `inferred` with confidence metadata.
- Surface the new edge type through the API consumed by the frontend, including sample counts and `lastSeenAt` timestamps.
- Update the frontend graph renderer to display dashed lines/tooltips for inferred edges without breaking existing layouts.

## Non-Goals
- Create auto-trigger logic based on inferred edges.
- Decide on UI styling beyond minimal affordances (e.g., color, dashed stroke) necessary for clarity.
- Implement replay/backfill or monitoring (separate tickets).

## Implementation Sketch
1. Add catalog query helpers that aggregate sampling data into edge DTOs, filtering by freshness threshold (configurable default 30 days).
2. Update `workflowGraph.ts` to merge inferred edges into the response payload with a new `edges.eventSourceToStep` block or similar, tagging them as inferred and attaching counts.
3. Version the shared topology types in `@apphub/shared/workflowTopology` and adjust the frontend graph hook to consume the enriched schema.
4. Implement frontend rendering changes (dashed edges, tooltip listing sample count and last seen) plus unit snapshot coverage.

## Deliverables
- Catalog topology builder and shared type updates that include inferred event edges.
- Frontend graph rendering adjustments demonstrating inferred edges in storybook or screenshot tests.
- Release notes and QA checklist covering regression tests for existing topology features.
