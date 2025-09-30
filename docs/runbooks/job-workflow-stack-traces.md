# Job & Workflow Failure Stack Traces

When any sandboxed bundle, static job handler, or workflow step fails, AppHub now stores the full stack trace and error metadata alongside the run context.

## Where to Look

- **Job runs (`job_runs.context`)** – on failure you will find `error`, `errorName`, `stack`, optional `properties`, and sandbox telemetry (`sandboxLogs`, `sandboxTaskId`, etc.).
- **Workflow runs (`workflow_runs.context`)** – the per-step runtime context contains `errorStack`, `errorName`, `errorProperties`, and the raw job run `context` snapshot for the failing step.
- **Logs (`benchmark-run.log`, aggregator output)** – structured log entries such as `Sandbox reported error`, `Job handler threw error`, and `Workflow orchestration error` now include stack traces and large metadata chunks. Long string fields are chunked to avoid truncation.

## Validation Steps

1. Re-run the failing workflow or job.
2. Inspect the latest job run via the catalog service (`/jobs/runs/:id`) and confirm the `context.stack` field contains the captured stack trace.
3. For workflows, fetch the workflow run record and locate the failing step in `context.steps[stepId]`. Confirm `errorStack` matches the job stack.
4. Tail `benchmark-run.log` – you should see stack traces in sandbox and workflow log messages. Multi-line stacks are preserved and chunked where necessary.

## Notes

- Sensitive data embedded in stacks should be redacted at the source. If redaction is required, extend the job handler to scrub values before throwing.
- For extremely large stacks the aggregator will receive chunked arrays; downstream log processors must join these chunks if a single string is required.
- Sandbox crashes (timeout, SIGKILL) set contextual fields such as `timeoutMs`, `exitCode`, and `signal` in addition to the stack trace metadata.
