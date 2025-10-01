# Decision Record · Ticket 094 – Graph Visualization Stack

## Context
The workflow topology explorer needs an interactive canvas that can render multi-tenant DAGs (workflows, steps, triggers, assets, event sources) with pan/zoom, themed styling, and support for tens of thousands of edges without stalling the UI. We evaluated candidate libraries against requirements from Ticket 090 (accessibility, responsiveness, customization, and runtime overlays).

## Options Considered

| Library | Pros | Cons |
| --- | --- | --- |
| **React Flow 11** | Mature React integration, declarative node/edge definitions, built-in virtualization (`onlyRenderVisibleElements`), supports custom theming, drag/pan, fitView, background/controls, dagre interop already in repo (asset graph). | Requires manual layout (handled via dagre), need to supply ResizeObserver polyfill for tests, smallest bundle still ~120 KB gzip. |
| Cytoscape.js + React bindings | Extremely performant for huge graphs, physics layouts, rich styling API. | Imperative bridge in React, theming via stylesheet string, cybernetically heavy to customize per design tokens, more complex to integrate with screen readers, larger bundle (190 KB gzip + React bridge). |
| Reaflow | Lightweight DAG renderer with dagre built-in, nice defaults. | Less active maintenance, limited interactivity hooks (no virtualization, coarse zoom controls), harder to mix custom nodes, code-splitting story weaker. |

## Decision
Select **React Flow** as the visualization foundation. It balances performance and ergonomics, already exists in the dependency tree for the asset graph, and aligns with our Vite/React tooling. Dagre-driven layout keeps us deterministic while React Flow handles interaction, virtualization, and node lifecycle. The theming hooks added in `WorkflowGraphCanvas` expose our design tokens without forking the library.

## Consequences
- Reused dagre 0.8.5 for layout so there is one graph layout dependency across asset and workflow canvases.
- The new `WorkflowGraphCanvas` component lives under `apps/frontend/src/workflows/components/` and consumes normalized data produced in Ticket 093. It exposes theme overrides, layout overrides, and selection highlighting for Ticket 095 to build upon.
- Tests require a `ResizeObserver` stub in `vitest.setup.ts`; already added.
- Future work (Ticket 095/096) can extend the canvas with keyboard focus, overlay layers, and live status badges without re-evaluating the rendering stack.

## Follow-ups
- Integrate advanced keyboard navigation and detail drawer interactions (Ticket 095).
- Layer runtime/event overlays once core emits live updates (Ticket 096).
- Monitor bundle impact; if React Flow grows we can explore code-splitting the topology view behind route-level chunks.
