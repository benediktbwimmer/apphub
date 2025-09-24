# Ticket 014: Import Workspace Wizard & Dependency-Aware UX

## Problem Statement
`ImportWorkspace.tsx` is a monolithic component that attempts to manage services, apps, jobs, workflows, and scenario bundles from a single state machine. Users toggle between subtabs, but the flows are deeply intertwined: loading an example job silently depends on services and apps being registered, errors surface late, and the “Load all examples” button provides limited feedback. The component’s size (~1.1k lines) and shared state impede maintainability and make it hard to evolve the UX.

## Goals
- Redesign the import experience as a staged wizard that guides operators through service manifests → apps → jobs → workflows (or lets them pick an alternate flow explicitly).
- Model dependencies between examples so selecting a job or workflow auto-enqueues required services/apps and surfaces progress/validation inline.
- Break the existing component into focused submodules/hooks with clear responsibilities, improving readability and testability.
- Provide real-time progress UI (leveraging the new packaging orchestrator) including granular status, retry affordances, and comprehensive error reporting.
- Ensure the wizard still supports ad-hoc uploads/registry imports alongside curated examples.

## Non-Goals
- Backend orchestration changes beyond consuming new APIs/events; those are covered in other tickets.
- Visual design overhaul beyond layout adjustments required to support the wizard flow (full rebrand deferred).

## Implementation Sketch
1. **Experience Design**
   - Partner with design to produce wireframes for the wizard: entry screen, dependency prompts, progress views, completion summary.
   - Define UX for mixed flows (e.g. user uploads a custom bundle after loading examples) and rollback/reset interactions.

2. **State Architecture**
   - Replace the single `ImportWorkspace` component with domain-specific providers/hooks (e.g. `useServiceImports`, `useJobImports`).
   - Introduce a dependency graph sourced from the examples registry to determine prerequisite resources and drive UI decisions.

3. **Progress & Feedback**
   - Subscribe to orchestrator events (Ticket 013) to display per-resource progress, including queued/packaging/imported states, with inline logs on failure.
   - Add status chips or timeline components that highlight which dependencies remain outstanding.

4. **Testing Strategy**
   - Add component/unit tests covering wizard transitions, dependency resolution, and error states.
   - Update Playwright/Vitest coverage to ensure the wizard loads all examples end-to-end and handles partial failures gracefully.

5. **Documentation**
   - Update user docs with the new flow and troubleshooting tips.
   - Provide internal guidance on extending the wizard with new example bundles or resource types.

## Deliverables
- New wizard-based import UI with modularized React components and hooks.
- Dependency-aware flows that auto-import prerequisites and display progress.
- Updated automated tests reflecting the redesigned experience.
- Documentation explaining the new workflow for operators and contributors.
