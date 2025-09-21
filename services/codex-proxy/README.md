# Codex Proxy Service

The Codex proxy is a lightweight FastAPI service that runs on the host machine and exposes the local `codex` CLI over HTTP. Containers or remote processes can call the proxy instead of mounting the Codex binary directly into their sandbox.

## Quick start

```bash
cd services/codex-proxy
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install .
export CODEX_PROXY_CLI=/opt/homebrew/bin/codex  # adjust for your system
export CODEX_PROXY_TOKEN="change-me"
export CODEX_PROXY_EXEC_OPTS="--skip-git-repo-check"
codex-proxy
```

The server listens on `127.0.0.1:3030` by default. Override with `CODEX_PROXY_HOST` and `CODEX_PROXY_PORT`.

## API overview

- `POST /v1/codex/jobs` — start an asynchronous Codex execution and return a `jobId` plus initial status (`pending`/`running`).
- `GET /v1/codex/jobs/{jobId}` — fetch the latest status, stdout/stderr buffers, output JSON (once ready), exit information, and timestamps.
- `POST /v1/codex/generate` — legacy blocking helper that waits for the CLI to finish and returns the final JSON payload.

Example request body (for either `POST` endpoint):

```json
{
  "mode": "workflow",
  "operatorRequest": "Generate an ingestion workflow",
  "metadataSummary": "Summaries of existing jobs and services",
  "additionalNotes": "Optional clarifications",
  "timeoutMs": 600000
}
```

Both endpoints also accept an optional `contextFiles` array. Each entry provides a relative `path` and `contents`; the proxy writes these files into the Codex workspace before launching the CLI. This is how the catalog service shares JSON Schemas (`context/schemas/*.json`) and Markdown summaries with Codex.

`GET /v1/codex/jobs/{jobId}` replies with:

```json
{
  "jobId": "e4f4a36d...",
  "status": "running",
  "stdout": "… streamed log output …",
  "stderr": "",
  "output": null,
  "summary": null,
  "error": null,
  "exitCode": null,
  "durationMs": null,
  "createdAt": "2025-09-21T18:42:13.189Z",
  "startedAt": "2025-09-21T18:42:13.411Z",
  "completedAt": null,
  "updatedAt": "2025-09-21T18:42:15.012Z"
}
```

If `CODEX_PROXY_TOKEN` is set, send `Authorization: Bearer <token>` or `X-AppHub-Proxy-Token: <token>` on every request.

## Environment variables

| Variable | Description |
| --- | --- |
| `CODEX_PROXY_CLI` | Absolute path to the Codex CLI executable (defaults to `codex`). |
| `CODEX_PROXY_EXEC_OPTS` | Extra arguments appended between `codex exec` and the instruction path. The proxy still injects a sandbox flag when none is present. |
| `CODEX_PROXY_DEFAULT_SANDBOX` | Sandbox policy automatically appended via `--sandbox` when no sandbox flag is found (defaults to `workspace-write`; set to an empty string to skip). |
| `CODEX_PROXY_TIMEOUT_MS` | Default timeout applied when the request does not provide one (milliseconds, defaults to `600000`). |
| `CODEX_PROXY_TOKEN` | Shared secret required on every request when set. |
| `CODEX_PROXY_KEEP_WORKSPACES` | When truthy, preserves the temporary workspace directory for inspection. |
| `CODEX_PROXY_DEBUG_LOGS` | When truthy, enables verbose logging to stdout. |
| `CODEX_PROXY_JOB_RETENTION_SECONDS` | Seconds to retain finished jobs in memory (default `3600`). |

Each job prepares an isolated workspace, writes `instructions.md` plus context files, streams `codex exec` stdout/stderr into memory, and exposes incremental progress via `GET /v1/codex/jobs/{jobId}`. Completed jobs include the parsed `suggestion.json` payload (in `output`) and the optional `summary.txt` contents.
