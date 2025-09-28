# Ticket 093: Frontend Graph Data Model & State Management

## Problem Statement
The frontend needs a reliable way to fetch, normalize, and manage workflow graph data prior to rendering. Today we lack a shared store for topology information, and we do not yet integrate graph updates from the catalog API or event stream.

## Goals
- Implement a typed client (likely using the existing API layer) to retrieve the graph payload and expose react-query or equivalent hooks for the UI.
- Normalize graph nodes/edges into lookup maps suitable for visualization, search, and interaction workflows.
- Handle loading, error, and refresh states, including optional optimistic updates when topology changes are detected.
- Integrate workflow event stream subscriptions to enqueue incremental updates for later status overlays.

## Non-Goals
- Rendering the graph or designing the visualization layer (Ticket 094).
- Final live status visualization (Ticket 096).
- Caching beyond what’s provided by the existing frontend data layer.

## Implementation Sketch
1. Define TypeScript interfaces mirroring the backend graph payload; add to `packages/shared` if cross-usage is required.
2. Extend the frontend API client to call the new `/api/workflows/graph` endpoint, applying authentication tokens/scopes as needed.
3. Create hooks/stores (e.g., `useWorkflowGraph`) that:
   - Fetch and cache the graph payload.
   - Expose selectors for workflows, assets, triggers.
   - Provide refresh mechanisms.
4. Wire the existing websocket/event bus client to enqueue topology-related events into the store, ready for Ticket 096 to consume.
5. Write unit tests and Storybook mocks ensuring the data layer behaves predictably across edge cases.

## Deliverables
- New frontend API call + typed hook/store for workflow graph data.
- Normalization utilities with tests.
- Documentation in the frontend README describing data flow and extension points.
