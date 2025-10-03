# Single VM Demo Deployment

This guide walks through provisioning the AppHub demo stack on a single Linux VM with Docker installed. The stack runs all services via Docker Compose and loads the Environmental Observatory module automatically in read-only mode so visitors can browse dashboards without launching workflows.

## 1. Prerequisites

- Ubuntu 22.04+ (or similar) with at least 4 vCPUs, 16 GB RAM.
- Docker Engine 24+ and Docker Compose plugin.
- Dedicated persistent disk (10–20 GB) mounted on the VM; examples below assume `/var/lib/apphub`.
- Outbound network access from the VM (for container image builds).

## 2. Prepare the VM

1. **Mount the data disk** (example for `/dev/nvme1n1`):
   ```bash
   sudo mkfs.ext4 /dev/nvme1n1
   sudo mkdir -p /var/lib/apphub
   echo '/dev/nvme1n1 /var/lib/apphub ext4 defaults 0 2' | sudo tee -a /etc/fstab
   sudo mount -a
   sudo chown "$USER":"$USER" /var/lib/apphub
   ```

2. **Clone the repository** (or copy the release bundle) onto the VM:
   ```bash
   git clone https://github.com/<your-org>/apphub.git
   cd apphub
   ```

3. **Create a demo environment file** (`docker/demo.env`):
   ```bash
   cat <<'ENV' > docker/demo.env
   # Persistent data root (mounted disk)
   APPHUB_DATA_ROOT=/var/lib/apphub

   # Optional public port overrides
   APPHUB_CORE_PORT=4000
   APPHUB_FRONTEND_PORT=4173
   APPHUB_MINIO_PORT=9000
   APPHUB_MINIO_CONSOLE_PORT=9001

   # Rotate these before sharing the demo externally
   APPHUB_SESSION_SECRET=$(openssl rand -hex 32)
   APPHUB_DEMO_ADMIN_TOKEN=demo-admin-token
   APPHUB_DEMO_SERVICE_TOKEN=demo-service-token
   APPHUB_DEMO_VIEWER_TOKEN=demo-viewer-token
   ENV
   ```

   You can regenerate the tokens later; the viewer token is baked into the frontend bundle so users can browse without signing in.

  The frontend build reads `APPHUB_FRONTEND_API_BASE_URL` when you run `docker compose ... --build`. On a remote VM, set this variable to the hostname or IP that browsers use to reach the demo (for example `APPHUB_FRONTEND_API_BASE_URL=http://demo.example.com:4000`) before building; otherwise the bundle defaults to `http://localhost:4000` and remote visitors will see DNS errors when the UI calls the API.

## 3. Build and launch the stack

1. **Build the runtime images and start the services**:
   ```bash
   cd docker
   docker compose -f demo-stack.compose.yml --env-file demo.env up -d --build
   ```

2. **Wait for bootstrap to finish**. The `demo-bootstrap` container runs a one-shot script that publishes the observatory module, creates the observatory config file under `/var/lib/apphub/scratch`, and synchronises workflows/triggers.
   ```bash
   docker compose -f demo-stack.compose.yml --env-file demo.env logs -f demo-bootstrap
   ```
   When the container exits with code `0`, the demo data generator schedule is live.

3. **Validate the stack**:
   - `docker compose ... ps` should show all core and worker containers as `healthy` or `running`.
   - Browse the frontend at `http://<vm-host>:4173/` (or the port specified in `APPHUB_FRONTEND_PORT`).
   - The UI is automatically authenticated with the read-only token and showcases the Environmental Observatory dashboards.

## 4. Operating the demo

- **Read-only mode**: The bundled viewer token only grants `jobs:read`, `workflows:read`, `filestore:read`, `metastore:read`, and `timestore:sql:read` scopes. Buttons that launch jobs or workflows remain disabled.
- **Admin access**: Use the admin token from `demo.env` with the “Settings → API Access” page if you need elevated access during internal demos.
- **Persistent state**: Postgres, Redis snapshots, MinIO objects, and the AppHub scratch space all live under `/var/lib/apphub`. Snapshot or back up that directory to preserve demo content.
- **Rebuilding the frontend token**: To rotate the viewer token, update `APPHUB_DEMO_VIEWER_TOKEN` in `demo.env` and rebuild (`docker compose ... up -d --build`). The build arg rewrites the token baked into the frontend bundle.
- **Tearing down**: `docker compose -f demo-stack.compose.yml --env-file demo.env down` stops containers but keeps volumes. Remove the `/var/lib/apphub` data root if you want a clean slate.

## 5. Troubleshooting

| Symptom | Check |
| --- | --- |
| `demo-bootstrap` fails | Inspect logs for HTTP 4xx/5xx responses; ensure tokens in `demo.env` match `APPHUB_OPERATOR_TOKENS` in the compose file and that all services report `healthy` status. Running `docker compose ... run --rm demo-bootstrap` retries the bootstrap. |
| Frontend shows blank/redirects | Confirm `core-api` is reachable from the VM (`curl http://localhost:4000/healthz`) and that the frontend build used the correct `VITE_API_BASE_URL` (set via build args in the compose file). |
| Schedules not running | Check the `core-workflows` logs for queue errors and confirm Redis is reachable; the read-only viewer token cannot restart runs, but the service token can if you re-run the bootstrap script. |

## 6. Security notes

- Rotate demo secrets before sharing the stack publicly.
- The viewer token is embedded in the static frontend; treat it as public knowledge.
- Restrict inbound access to the VM (e.g., allow HTTP/HTTPS only) and disable the MinIO console (`APPHUB_MINIO_CONSOLE_PORT`) if not required.

With these steps completed the Environmental Observatory module loads automatically, the synthetic data generator runs on its schedule, and visitors can explore the dashboards safely without modifying the environment.
