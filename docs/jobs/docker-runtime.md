# Docker Job Runtime

Catalog workers can execute job definitions inside Docker containers. The runtime is disabled by default and must be explicitly enabled and configured before workloads are accepted.

## Feature Flag
Set `CATALOG_ENABLE_DOCKER_JOBS=1` to allow API callers to register or update job definitions whose `runtime` is `docker`. When the flag is off, catalog rejects Docker jobs during validation and the runtime readiness endpoint reports the capability as unavailable.

## Runtime Configuration
Docker execution is governed by environment variables that are validated at process start. Bad values cause the worker to crash so misconfiguration is detected early.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CATALOG_DOCKER_WORKSPACE_ROOT` | `${TMPDIR}/apphub-docker-workspaces` | Absolute path where per-run workspaces are created. |
| `CATALOG_DOCKER_IMAGE_ALLOWLIST` | *(empty)* | Comma-separated glob patterns of allowed images. If provided, jobs must match one of the patterns. |
| `CATALOG_DOCKER_IMAGE_DENYLIST` | *(empty)* | Comma-separated glob patterns of forbidden images. Deny rules run before allow rules. |
| `CATALOG_DOCKER_MAX_WORKSPACE_BYTES` | `10737418240` (10 GiB) | Maximum total bytes of staged inputs per run. Set to `0` or `unlimited` to disable. |
| `CATALOG_DOCKER_ENABLE_GPU` | `false` | Allow jobs to request GPU support. When `false`, metadata with `requiresGpu: true` is rejected. |
| `CATALOG_DOCKER_ENFORCE_NETWORK_ISOLATION` | `true` | Force containers onto the `none` network regardless of metadata. |
| `CATALOG_DOCKER_DEFAULT_NETWORK_MODE` | `none` | Default Docker network used when isolation is not enforced. Must be included in the allowed modes list. |
| `CATALOG_DOCKER_ALLOWED_NETWORK_MODES` | `none,bridge` | Comma-separated list of network modes that jobs may request. |
| `CATALOG_DOCKER_ALLOW_NETWORK_OVERRIDE` | `false` | Permit metadata to override the default network mode (only applies when isolation is disabled). |

Configuration is cached; call `clearDockerRuntimeConfigCache()` in tests before changing environment variables.

## Metadata Contract
A Docker job definition must provide metadata under the `docker` key. The shape below illustrates supported fields and defaults:

```json
{
  "docker": {
    "image": "registry.example.com/tools/report-runner:1.2.3",
    "imagePullPolicy": "ifNotPresent",
    "entryPoint": ["/usr/local/bin/run"],
    "command": ["--config", "/workspace/config/run.json"],
    "args": ["--verbose"],
    "workingDirectory": "/workspace",
    "workspaceMountPath": "/workspace",
    "networkMode": "none",
    "requiresGpu": false,
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

**Key points**
- `image` is mandatory and must satisfy allow/deny policies.
- `requiresGpu` is optional; when set, GPU support must be enabled at runtime.
- `networkMode` may be omitted - the worker applies the configured default or `none` when isolation is enforced.
- Environment entries require either a literal `value` or a `secret`. When `secret` is present the `value` field must be omitted to prevent inline secret leakage.
- `inputs[*].workspacePath` values are scoped to the per-run workspace and are mounted read-only inside the container. The legacy `writable` flag is rejected.
- `outputs[*].workspacePath` identifies directories/files that the container writes beneath the workspace mount. Upload descriptors describe how artifacts are published back to Filestore.

All paths must be forward-slash separated. Relative paths cannot include `.` or `..` segments or start with `/`. Absolute container paths must not contain traversal or backslashes. Duplicate identifiers for environment variables, inputs, or outputs are rejected (case-insensitive for env vars).

## Policy Enforcement
The worker validates metadata and runtime execution against the configured policies:

- **Image provenance** - Deny-list patterns block execution outright. When an allow-list is present the image reference must match one of the patterns (`*` and `?` wildcards are supported).
- **Environment handling** - Secrets are always resolved through `context.resolveSecret`. Inline secret values are rejected during validation and never logged.
- **Workspace mounts** - Catalog creates an isolated workspace per run underneath `CATALOG_DOCKER_WORKSPACE_ROOT`. Inputs are materialised inside the workspace and mounted into the container as read-only bind mounts. Outputs are written through the primary workspace mount so containers cannot read host data outside the sandbox.
- **Workspace size** - If staged inputs exceed `CATALOG_DOCKER_MAX_WORKSPACE_BYTES`, execution fails before the container is launched. Use Filestore path templates to partition large datasets rather than downloading them wholesale.
- **Network isolation** - When isolation is enforced, containers always run with `--network none`. Otherwise the default network and the set of allowed modes are derived from configuration, and overrides are optional.
- **GPU access** - Jobs request GPUs via `requiresGpu`. The worker adds `--gpus all` only when GPUs are enabled globally; otherwise validation and execution abort with a clear error.

## Operational Checklist
1. Enable the feature flag and choose a workspace root with adequate disk space.
2. Define allow/deny image policies that reference trusted registries (for example `company-registry.local/*`).
3. Decide whether workloads may attach to Docker networking. Keep isolation enabled unless workloads truly require outbound access.
4. Set `CATALOG_DOCKER_MAX_WORKSPACE_BYTES` to reflect available scratch disk. Lower values help guard against unbounded downloads.
5. Populate secrets in the configured stores so `context.resolveSecret` can inject them at runtime. Never bake credentials into metadata literals.
6. Document operational expectations (GPU availability, network access, workspace limits) for job authors so validation errors are predictable.
