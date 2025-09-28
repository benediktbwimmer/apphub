# Ticket 112: Stage Filestore Inputs and Outputs for Docker Jobs

## Problem
Docker workloads must consume configuration and data from Filestore and publish results back. The catalog workers currently have no utilities for downloading nodes to disk or uploading generated artifacts post-run, so Docker jobs would execute with empty inputs and lose outputs.

## Proposal
- Embed the `@apphub/filestore-client` in the catalog worker so jobs can authenticate and stream files.
- Implement input staging: for each descriptor in job metadata, download the referenced node (by backend/path or node ID), verify integrity, and place it under the workspace using deterministic naming.
- Implement output collection: after the container exits, locate declared output files/globs, upload them to Filestore (respecting overwrite policies), and record resulting node metadata.
- Provide templating helpers for path prefixes (e.g. `${runId}`) and inject run metadata into uploads.
- Capture bytes transferred and attach references (backendMountId, nodeId, path, checksum) to the job result payload for downstream consumers.

## Deliverables
- Reusable staging/upload utilities with integration tests that mock Filestore server responses.
- Configuration plumbing for Filestore base URL/token, including fallbacks to internal service discovery.
- Job runner integration points that call staging before Docker launch and collection after completion.
- Result serialization updates ensuring output metadata is persisted in `JobRun.result` or `context`.

## Risks & Mitigations
- **Large file handling:** Stream downloads/uploads to disk without buffering entire files; enforce configurable size limits.
- **Credential management:** Store tokens securely (e.g. via secret resolver) and avoid logging sensitive values.
- **Partial failures:** Implement retry/backoff for uploads and ensure failures transition the job to `failed` with clear context instead of silently skipping artifacts.
