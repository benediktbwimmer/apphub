# Ticket 603: Align Monaco and ReactFlow Styling With Theme Tokens

## Problem
Monaco editor and ReactFlow graphs rely on bespoke color tables disconnected from the new token registry. Theme switches would leave these experiences inconsistent unless we propagate semantic colors imperatively.

## Proposal
- Refactor `useMonacoTheme` to consume token-derived palettes, regenerating editor themes whenever the active theme changes (background, line numbers, highlights).
- Extend `WorkflowGraphCanvas` theme context to source colors from semantic tokens and honour tenant overrides, exposing a clear mapping for node/edge variants.
- Create shared helpers to translate token sets into Monaco/ReactFlow configs, ensuring future themes require only token updates.

## Deliverables
- Monaco theme registration that reacts to provider updates and covers default plus custom themes.
- ReactFlow canvas wired to semantic tokens with regression tests for light/dark/high-contrast permutations.
- Documentation describing how new themes automatically flow into Monaco and graph surfaces.

## Risks & Mitigations
- **Runtime flicker:** Debounce theme updates and preload Monaco definitions during boot to avoid noticeable flashes.
- **Graph legibility:** Validate edge and label colors with design for high-contrast variants and capture Storybook references.
