# AI-Assisted Workflow Builder

The AI builder introduces a guided experience for generating workflow and job definitions inside the operator console. Operators describe the desired automation, review Codex output, apply edits, and submit the definition without leaving the page. The builder reuses the catalog schemas so validation matches the API contracts.

## UI Overview
- Launch the builder from **Workflows → AI builder**. Visibility requires an operator token with either `workflows:write` or `jobs:write` scope (the existing `Create workflow` button still requires `workflows:write`).
- Enter a natural-language description plus optional notes. The frontend collects catalog metadata (jobs, services, workflows) and the backend summarises it for Codex.
- Codex runs via the CLI and writes the draft JSON to `./output/suggestion.json`; the UI never relies on the CLI printing the payload.
- The preview panel shows validation status using the shared Zod schemas. Operators can edit the JSON directly.
- Available actions:
  - **Submit workflow** (POST `/workflows`)
  - **Submit job** (POST `/jobs`)
  - **Review in manual builder** – opens the existing workflow builder pre-populated with the AI draft.
- Structured telemetry is emitted through `console.info('ai-builder.usage', …)` so we can observe acceptance, edits, and rejection patterns locally.

## Backend Endpoint
`POST /ai/builder/suggest`

Payload:
```json
{
  "mode": "workflow" | "job",
  "prompt": "...",
  "additionalNotes": "optional"
}
```

The handler checks operator scopes, gathers catalog metadata, and invokes the Codex CLI in a temporary workspace. The CLI is instructed (via `instructions.md`) to write the suggestion to `output/suggestion.json`, mirroring the CLI guidance that output should be redirected to files rather than stdout. The response includes the raw JSON, validation result, metadata summary, and truncated CLI logs. Validation uses the shared Zod schemas from `services/catalog/src/workflows/zodSchemas.ts`, which are now also consumed by the frontend.

Set `APPHUB_CODEX_MOCK_DIR` to a directory containing `workflow.json` and `job.json` to return deterministic fixtures—useful for local tests and CI.

## Publishing the AI Orchestrator Bundle
A reusable bundle backs the AI-driven workflow steps. Publish (or republish) it with:

```
npx tsx services/catalog/src/scripts/publishAiBundle.ts
```

Environment variables:

- `APPHUB_AI_BUNDLE_SLUG` (default `ai-orchestrator`)
- `APPHUB_AI_BUNDLE_VERSION` (default `0.1.0`)
- `APPHUB_CODEX_CLI`, `APPHUB_CODEX_EXEC_OPTS`, `APPHUB_CODEX_MOCK_DIR` – forwarded to the embedded handler so it can execute Codex inside the job sandbox.

The bundle handler mirrors the server-side runner: it writes instructions into a temp workspace, calls the Codex CLI, reads `suggestion.json`, and returns the raw/parsed payload inside the job result. It also streams CLI stdout/stderr back to the orchestration context for audit.

## Local Testing
- `npx tsx services/catalog/tests/codexRunner.test.ts` exercises the CLI mock path and ensures `APPHUB_CODEX_MOCK_DIR` is respected.
- `APPHUB_CODEX_DEBUG_WORKSPACES=1` keeps the generated workspaces on disk for inspection.
- The frontend uses Vite aliases to import `zodSchemas.ts` directly; run `npm run dev` in `apps/frontend` to verify hot reload.

For a full end-to-end check, publish the bundle, generate a workflow through the AI builder, and submit it. The new workflow appears in the sidebar without a page reload, and manual runs continue to work through the existing controls.
