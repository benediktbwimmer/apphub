# Ticket 032: Modularize Repository Ingestion Pipeline

## Problem
`processRepository` in `ingestionWorker.ts` encapsulates cloning, metadata extraction, tag enrichment, preview generation, and build scheduling inside a single 1.3k-line module. The lack of boundaries limits reuse (e.g., manual retries) and makes unit testing specific stages difficult.

## Proposal
- Extract pipeline stages into dedicated modules (git clone, metadata readers, tag aggregation, persistence, build scheduling).
- Define a lightweight pipeline orchestrator that composes the stages and emits structured metrics.
- Share the extracted helpers with retry endpoints and future batch tooling to avoid logic drift.
- Add unit tests per stage plus integration coverage for the orchestrated pipeline.

## Deliverables
- New stage modules with accompanying tests.
- Refactored ingestion worker using the modular pipeline.
- Updated documentation/narrative comments explaining stage responsibilities.

## Risks & Mitigations
- **Performance regression:** Benchmark ingestion duration before/after refactor; maintain streaming reads and reuse of existing fs helpers.
- **Complexity creep:** Keep stage interfaces minimal (inputs/outputs) and prefer pure functions where possible.
