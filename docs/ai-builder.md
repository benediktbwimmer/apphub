# AI-Assisted Workflow Builder

The AI builder introduces a guided experience for generating workflow and job definitions inside the operator console. Operators describe the desired automation, review Codex output, apply edits, and submit the definition without leaving the page. The builder reuses the catalog schemas so validation matches the API contracts.

## UI Overview
- Launch the builder from **Workflows → AI builder**. Visibility requires an operator token with either `workflows:write` or `jobs:write` scope (the existing `Create workflow` button still requires `workflows:write`).
- Enter a natural-language description plus optional notes. The frontend collects catalog metadata (jobs, services, workflows) and the backend summarises it for Codex.
- Codex runs via the host proxy service and writes the draft JSON to `./output/suggestion.json`; the UI streams CLI stdout/stderr while the job runs and never relies on the CLI printing the payload.
- The preview panel shows validation status using the shared Zod schemas. Operators can edit the JSON directly.
- Available actions:
  - **Submit workflow** (POST `/workflows`)
  - **Submit job** (POST `/ai/builder/jobs` → publishes bundle + registers definition)
  - **Review in manual builder** – opens the existing workflow builder pre-populated with the AI draft.
- Structured telemetry is emitted through `console.info('ai-builder.usage', …)` so we can observe acceptance, edits, and rejection patterns locally.
- Generations can be left running and resumed later; the dialog stores the active `generationId` locally and rehydrates stdout/stderr on reopen.

## Backend Endpoints

- `POST /ai/builder/generations` – start a Codex run and return a `generationId`, live stdout/stderr buffers, and initial status (`running`, `succeeded`, `failed`).
- `GET /ai/builder/generations/:generationId` – poll for the latest status, logs, and (once complete) the parsed/validated suggestion.
- `POST /ai/builder/suggest` – legacy synchronous helper retained for scripts/tests.

Both endpoints accept the original payload shape:

```json
{
  "mode": "workflow" | "job" | "job-with-bundle",
  "prompt": "...",
  "additionalNotes": "optional"
}
```

The catalog service checks operator scopes, gathers metadata, and calls the proxy's `/v1/codex/jobs`. The proxy writes `instructions.md` and `context/metadata.md`, streams `codex exec`, and exposes incremental stdout/stderr so the UI can render progress in real time. When the CLI finishes, the backend validates the JSON output (using the shared Zod schemas) and stores the result in an in-memory session map so operators can leave the dialog and return later without losing context. In `job-with-bundle` mode the response includes both the job definition and bundle blueprint, along with validation warnings when files or entry points are missing.

## Automated Job Creation

`POST /ai/builder/jobs`

Payload:

```json
{
  "job": { /* jobDefinitionCreateSchema payload */ },
  "bundle": {
    "slug": "…",
    "version": "…",
    "entryPoint": "index.js",
    "manifest": { /* job bundle manifest */ },
    "files": [
      { "path": "index.js", "contents": "…" }
    ]
  }
}
```

Operators with both `jobs:write` and `job-bundles:write` scopes can submit the edited job spec alongside the Codex-generated bundle blueprint. The API materialises the files, packages them into a tarball, publishes the bundle, and registers the job definition referencing `bundle:<slug>@<version>`. The response includes the persisted job plus bundle metadata (including the generated download link) so the UI can present next steps without additional CLI tooling.

Set `APPHUB_CODEX_MOCK_DIR` to a directory containing `workflow.json` and `job.json` to return deterministic fixtures—useful for local tests and CI.

## Publishing the AI Orchestrator Bundle
A reusable bundle backs the AI-driven workflow steps. Publish (or republish) it with:

```
npx tsx services/catalog/src/scripts/publishAiBundle.ts
```

Environment variables:

- `APPHUB_AI_BUNDLE_SLUG` (default `ai-orchestrator`)
- `APPHUB_AI_BUNDLE_VERSION` (default `0.1.0`)
- `APPHUB_CODEX_PROXY_URL`, `APPHUB_CODEX_PROXY_TOKEN`, `APPHUB_CODEX_MOCK_DIR` – forwarded to the embedded handler so it can reach the host proxy.

The bundle handler mirrors the server-side runner: it writes instructions into a temp workspace, calls the Codex CLI, reads `suggestion.json`, and returns the raw/parsed payload inside the job result. It also streams CLI stdout/stderr back to the orchestration context for audit.

## Local Testing
- `npx tsx services/catalog/tests/codexRunner.test.ts` exercises the CLI mock path and ensures `APPHUB_CODEX_MOCK_DIR` is respected.
- `CODEX_PROXY_KEEP_WORKSPACES=1` (or `APPHUB_CODEX_DEBUG_WORKSPACES=1`) keeps the proxy's temporary workspaces on disk for inspection.
- Generations persist server-side for one hour (`CODEX_PROXY_JOB_RETENTION_SECONDS` / in-memory session TTL) so you can resume polling later.
- The frontend uses Vite aliases to import `zodSchemas.ts` directly; run `npm run dev` in `apps/frontend` to verify hot reload.

For a full end-to-end check, publish the bundle, generate a workflow through the AI builder, and submit it. The new workflow appears in the sidebar without a page reload, and manual runs continue to work through the existing controls.
