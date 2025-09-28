# Workflow Topology Backend Assembly

Ticket 091 adds a dedicated assembly layer inside the catalog service that emits a normalized workflow topology graph.
This module is responsible for loading workflow definitions, schedules, event triggers, and asset declarations, and
condensing them into the shared `@apphub/shared/workflowTopology` payload that downstream clients consume.

## Module Overview
- **Entry point**: `services/catalog/src/workflows/workflowGraph.ts`
  - `buildWorkflowTopologyGraph()` orchestrates data loading from `listWorkflowDefinitions()` and
    `listWorkflowAssetDeclarations()` and returns a `WorkflowTopologyGraph`.
  - `assembleWorkflowTopologyGraph()` is a pure helper that accepts pre-hydrated definitions plus asset declarations and
    constructs the graph. Tests and future callers can inject fixture data without touching the database.
- **Shared contract**: `packages/shared/src/workflowTopology.ts` contains the canonical TypeScript types for all graph
  nodes and edges. These types are versioned (`version: 'v1'`) to support additive changes later on.
- **Helpers**:
  - DAG metadata is merged with step definitions via `applyDagMetadataToSteps()` to ensure `dependsOn`/`dependents`
    relationships align with orchestrator validation.
  - Asset IDs reuse `canonicalAssetId()` and `normalizeAssetId()` from `services/catalog/src/assets/identifiers.ts` so
    producers and consumers agree on casing and trimming rules.

## API Endpoint & Caching
- The catalog API exposes the graph at `GET /workflows/graph`, gated by the `workflows:write` operator scope.
- Responses come from an in-memory cache (`services/catalog/src/workflows/workflowGraphCache.ts`) that rebuilds on
  demand and invalidates when `workflow.definition.updated` events fire (workflow edits, schedules, triggers) or on
  explicit refresh. Set `APPHUB_WORKFLOW_GRAPH_CACHE_TTL_MS` to override the default 30 second TTL.
- Each response includes cache metadata (`meta.cache`) so clients can observe hit/miss rates and refresh timers.

## Output Contents
`assembleWorkflowTopologyGraph()` emits:
- Workflow nodes with basic metadata and derived annotations (owner, domain, environment tags) sourced from the
  definition metadata block.
- Step nodes for job, service, and fan-out templates, including runtime-specific fields (bundle strategy, request
  options, fan-out template metadata).
- Trigger nodes for definition-level schedules and event triggers, plus dedicated schedule nodes. Trigger edges cover
  `definition`, `event`, and `schedule` relationships.
- Asset nodes keyed by normalized asset ID, with edges for producing and consuming steps. Auto-materialize consumers add
  asset→workflow edges that capture the policy priority.
- Event source nodes keyed by event type/source pairs and edges to the triggers that listen to them.

## Testing Strategy
`services/catalog/tests/workflowGraph.test.ts` exercises the assembly helper with representative fixtures:
1. Linear DAG relationships and root edges.
2. Fan-out steps including template metadata.
3. Cross-workflow asset dependencies with auto-materialize policies.
4. Event trigger throttling metadata and event source deduplication.

Each test uses `assembleWorkflowTopologyGraph()` with handcrafted definitions to avoid external dependencies (database,
Redis, analytics jobs) while still covering canonicalization logic.

## Extension Points
- Additional node types (e.g., runtime overlays) can be layered by extending the shared type module and updating the
  assembler. Because assembly is pure, integration tests can cover new scenarios without bootstrapping the catalog
  stack.
- Downstream services should import the shared types instead of redefining payload interfaces to avoid drift.
- Future tickets can supply alternate data sources by calling `assembleWorkflowTopologyGraph()` directly and passing in
  custom bundles.
