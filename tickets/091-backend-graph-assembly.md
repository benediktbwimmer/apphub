# Ticket 091: Backend Workflow Graph Assembly Module

## Problem Statement
We need a single backend source of truth that assembles workflow topology data—including steps, DAG edges, event triggers, schedules, and asset dependencies—into a normalized graph payload. Catalog currently exposes fragments of this information across multiple modules; stitching it together repeatedly would be error-prone and duplicative.

## Goals
- Implement a TypeScript module under `services/catalog` that loads workflow definitions, schedules, event triggers, and asset declarations into a unified graph model.
- Reuse existing helpers (DAG metadata, asset normalization, trigger validation) to ensure new code stays consistent with orchestrator and materializer logic.
- Provide strongly typed node/edge structures with versioning metadata to support future API evolution.
- Cover the assembler with unit tests using representative fixtures, including partitioned assets and fan-out steps.

## Non-Goals
- Expose network endpoints or caching layers (handled in Ticket 092).
- Rebuild DAG validation or asset graph logic from scratch.
- Address live status overlays or runtime metrics.

## Implementation Sketch
1. Create a `workflowGraph` module that:
   - Calls `listWorkflowDefinitions`, hydrating schedules/event triggers via targeted queries.
   - Adopts the asset materializer’s canonicalization helpers to map produced/consumed assets.
   - Produces graph nodes for workflows, steps, triggers, schedules, assets, and external event sources; emits typed edges.
2. Introduce TypeScript types/interfaces exported for frontend consumption and future API serialization.
3. Add tests covering:
   - Simple linear workflows.
   - Fan-out templates.
   - Cross-workflow asset dependencies.
   - Event trigger dedupe/throttle metadata inclusion.
4. Document the module in `docs/workflow-topology/backend.md`, describing assumptions and extension points.

## Deliverables
- New `workflowGraph` module with typed graph assembly logic and tests.
- Updated shared types (`packages/shared` if needed) to describe graph payloads.
- Developer documentation outlining data sources and invariants.
