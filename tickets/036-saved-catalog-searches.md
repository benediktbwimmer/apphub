# Ticket 036: Introduce Saved Catalog Searches

## Problem
Operators frequently reuse tag stacks and filters but must recreate them manually each session. There is no native concept of saved searches or shareable collections.

## Proposal
- Persist named searches (query text, tag filters, sort preferences) tied to the operator’s identity.
- Surface saved searches in the catalog UI with quick-apply buttons and sharing links (slugged IDs).
- Extend the catalog API to CRUD saved search definitions with appropriate scope checks.
- Emit analytics for creation, application, and sharing to gauge adoption.

## Deliverables
- Backend endpoints and Postgres tables for saved searches.
- Frontend UX for managing and applying saved searches.
- Tests covering creation, retrieval, and application flows.

## Risks & Mitigations
- **Scope management:** Ensure saved searches respect existing token scopes and prevent leakage across operators.
- **Migration complexity:** Start with per-user saves before layering on organization-wide sharing.
