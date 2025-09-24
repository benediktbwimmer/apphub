# Ticket 015: Clarify Service vs. App Boundaries with Types & Documentation

## Problem Statement
Operators struggle to understand when to register a “service” versus an “app.” Services manage manifests and network endpoints, while apps focus on containerized workloads, but the distinction is blurred in code and documentation. Shared helpers mix terminology, the API accepts broad metadata with minimal validation, and the frontend does not highlight the differences. This ambiguity contributed to confusion when loading examples and complicates future extensibility.

## Goals
- Produce crisp architectural guidance (docs + diagrams) describing the lifecycle, responsibilities, and relationships between services, apps, jobs, and workflows.
- Encode the distinction in TypeScript/Zod schemas so API consumers and frontend components get stronger validation and autocomplete.
- Update API routes to enforce clearer payload contracts (e.g., services emphasize manifests/network config, apps emphasize Docker builds) with actionable error messages.
- Enhance the frontend import wizard (Ticket 014) to surface contextual help and validation specific to services vs. apps.
- Align tests and example data to reflect the clarified boundary (naming, tags, metadata).

## Non-Goals
- Major data model migrations beyond adding new columns/fields required for clarity; deep schema redesign can follow later if needed.
- Overhauling service discovery/health polling internals.

## Implementation Sketch
1. **Research & Documentation**
   - Audit existing docs (`docs/architecture.md`, service manifests, import flows) to extract current behavior.
   - Draft a concise architecture appendix detailing each resource type, including diagrams and example timelines.

2. **Schema Enhancements**
   - Refine Zod schemas in `services/catalog` to reflect distinct properties (e.g., required manifest references for services, required Dockerfile metadata for apps).
   - Extend TypeScript types in the frontend (`apps/frontend/src/services/types.ts`, etc.) to match the new contracts.

3. **API Validation & Messaging**
   - Update endpoints for service registration, app ingestion, and imports to validate against the refined schemas and return targeted errors.
   - Add logging/audit entries that record the resource type and validation issues for observability.

4. **Frontend Support**
   - Inject contextual tooltips/help panels in the wizard (leveraging Ticket 014) that explain resource expectations and link to docs.
   - Adjust example metadata (from Ticket 012) to include explicit dependency hints (e.g., `requiresService`, `requiresApp`).

5. **Testing & Rollout**
   - Add unit/integration tests for new validation rules and documentation examples.
   - Update onboarding docs and release notes to highlight the clarified boundaries.

## Deliverables
- Updated architecture documentation and diagrams clarifying resource boundaries.
- Strengthened schemas/types enforcing distinctions between services and apps.
- API responses and frontend UX that communicate expectations clearly.
- Tests and examples aligned with the new guidance.
