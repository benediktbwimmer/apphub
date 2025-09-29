# Ticket 504: Build Shared Frontend API Client With Runtime Validation

## Problem
Frontend workspaces duplicate fetch logic (see `apps/frontend/src/jobs/api.ts` and `apps/frontend/src/workflows/api.ts`), manually parsing JSON and guarding against `payload.data` being missing. The boilerplate obscures real errors, scatters retry logic, and increases the risk of inconsistent error handling.

## Proposal
- Design a shared HTTP client utility (e.g., `apps/frontend/src/lib/apiClient.ts`) that wraps `fetch`, applies auth headers, handles JSON parsing, and maps HTTP errors into a common `ApiError`.
- Layer optional zod-based response validation to guarantee runtime type safety and collapse scattered `if (!payload.data)` checks.
- Migrate jobs and workflows API modules to the shared client, demonstrating improved ergonomics and catching parsing edge cases.
- Provide guidance (README snippet or doc) for other feature teams to adopt the client.

## Deliverables
- Shared API client with configurable base URL, error mapping, and optional schema validation.
- Refactored jobs/workflows API modules consuming the client.
- Unit tests for the client covering success, HTTP error, and malformed JSON scenarios.

## Risks & Mitigations
- **Bundle size:** Tree-shakeable design and lightweight schema usage prevent significant growth; monitor Vite bundle reports during rollout.
- **Migration overhead:** Offer codemods or examples to accelerate adoption and prevent divergence between old and new patterns.
