# Ticket 096: Live Status Overlay & Refresh Strategy

## Problem Statement
Operators need real-time cues about workflow health—run statuses, trigger reliability, asset freshness—directly on the topology graph. Without an efficient overlay and refresh strategy, the visualization will drift from actual system state or overwhelm clients with noisy updates.

## Goals
- Layer live status indicators onto the graph (e.g., node badges, edge coloring) reflecting workflow runs, asset freshness, and trigger pause/failure states.
- Consume event bus updates (`workflow.run.*`, `asset.*`, trigger metrics) to incrementally update the UI without full refetches.
- Implement throttling/debouncing logic to balance responsiveness with performance on large graphs.
- Provide clear legends, status tooltips, and fallback states when live data is unavailable.

## Non-Goals
- Modifying the backend event emission pipeline.
- Persisting historical metrics beyond what is needed for the overlay.
- Building automated alerting (handled elsewhere).

## Implementation Sketch
1. Extend the frontend graph store to process event stream payloads into incremental state patches (leveraging groundwork from Ticket 093).
2. Define a status mapping (e.g., running/succeeded/failed, stale/fresh assets, trigger paused) and visualization rules in the canvas component.
3. Add throttled refresh loops to reconcile occasional full graph refetches with incremental updates; expose controls for manual refresh.
4. Implement resilience features: retry/backoff on websocket disconnect, warning banner when live data is stale, logging for dropped events.
5. Write tests covering update batching, throttling logic, and visual regression for status states.

## Deliverables
- Live status overlay integrated into the graph with controls and legends.
- Event-driven update pipeline with throttling and resilience handling.
- Tests and documentation describing status semantics and troubleshooting steps.
