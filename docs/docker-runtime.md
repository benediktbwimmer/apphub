# Docker Job Runtime Metadata

The catalog service now accepts job definitions that target a Docker runtime. Execution support is gated behind a later rollout, but schema validation and metadata contracts are available so clients can begin authoring definitions safely.

## Feature Flag
Enable Docker job schema validation by setting the environment variable:

```
CATALOG_ENABLE_DOCKER_JOBS=1
```

When the flag is disabled (default), create/update requests that declare `runtime: "docker"` are rejected. The runtime readiness endpoint also reports Docker as unavailable in this state.

## Metadata Contract
Docker jobs must provide a `metadata` payload shaped as follows:

```json
{
  "docker": {
    "image": "registry.example.com/tools/report-runner:1.2.3",
    "imagePullPolicy": "ifNotPresent",
    "entryPoint": ["/bin/run"],
    "command": ["--config", "/workspace/config/run.json"],
    "workingDirectory": "/workspace",
    "workspaceMountPath": "/workspace",
    "networkMode": "bridge",
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "API_TOKEN", "secret": { "source": "store", "key": "docker-jobs/api-token" } }
    ],
    "configFile": {
      "filename": "config/run.json",
      "mountPath": "/workspace/config/run.json",
      "format": "json"
    },
    "inputs": [
      {
        "id": "bundle-config",
        "source": { "type": "filestorePath", "backendMountId": 3, "path": "/bundles/report/config.json" },
        "workspacePath": "inputs/config.json",
        "mountPath": "/workspace/inputs/config.json"
      }
    ],
    "outputs": [
      {
        "id": "report",
        "workspacePath": "outputs/report.pdf",
        "upload": {
          "backendMountId": 5,
          "pathTemplate": "reports/${runId}/report.pdf",
          "contentType": "application/pdf",
          "overwrite": true
        }
      }
    ]
  }
}
```

### Field Summary
- **image** *(required)* – Fully-qualified image reference.
- **imagePullPolicy** – `always` or `ifNotPresent` (default).
- **entryPoint / command / args** – Optional arrays of strings; empty entries are trimmed.
- **workingDirectory** – Absolute path inside the container. Defaults to the workspace mount when omitted.
- **workspaceMountPath** – Location where the per-run workspace will be mounted inside the container (defaults to `/workspace`).
- **networkMode** – Either `bridge` (default) or `none`.
- **environment** – Up to 200 variables. Each entry must include either a literal `value` or a `secret` reference (`{ source: 'env' | 'store', key, version? }`). Duplicate names are rejected (case-insensitive).
- **configFile** – Describes a generated config artifact (`filename` must be a safe relative path; `mountPath` must be absolute inside the container).
- **inputs** – Up to 100 descriptors that stage data into the workspace. Supported sources are `filestoreNode` (by node id) or `filestorePath` (backend + absolute path). `workspacePath` must be relative (no `..` segments). Optional `mountPath`, `writable`, and `optional` flags describe container expectations.
- **outputs** – Up to 100 descriptors describing artifacts the container will write. Each entry specifies an upload target (`backendMountId`, `pathTemplate`, optional `contentType`, `mode`, `overwrite`).

All paths use forward slashes. Relative paths cannot contain `.` or `..` segments or start with `/`. Absolute container paths cannot contain traversal segments or backslashes. Duplicate input/output identifiers produce validation errors.

## Validation Behaviour
- Requests fail with a 400 error if Docker metadata is missing or malformed.
- Invalid environment names, unsafe paths, duplicate identifiers, or unsupported sources surface precise error messages via Zod.
- Successful parsing stores the sanitized metadata so downstream code can rely on normalized casing and trimmed values.

Execution wiring (`docker run`, Filestore staging, observability) lands in follow-up tickets. For now, Docker job definitions can be registered, inspected via the API, and surfaced in the UI without impacting existing Node/Python workloads.
