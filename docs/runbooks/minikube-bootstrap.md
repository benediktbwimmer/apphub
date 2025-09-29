# Minikube Bootstrap Runbook

Ticket 182–185 introduced a Kubernetes-first workflow for AppHub. This document consolidates the prerequisites, turnkey command, validation steps, and troubleshooting guidance for running the full stack on minikube.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Docker | 24+ | Required for building the runtime images. |
| minikube | 1.33+ | Enable virtualization with at least 4 CPUs / 8 GiB RAM. |
| kubectl | 1.27+ | Automatically installed with minikube, but keep the client available on your PATH. |
| npm | 10+ | Used to run the bootstrap scripts. |

Ensure your user can run `docker` commands without sudo and that minikube can access the Docker daemon (`minikube config set driver docker` is recommended on macOS/Linux).

## Bootstrap the stack

```bash
npm run minikube:up
```

The script performs the following:

1. Starts minikube with the recommended resources (unless already running).
2. Enables the NGINX ingress addon.
3. Builds all service images with the ingress-facing `VITE_API_BASE_URL` baked in.
4. Loads the images into the minikube image cache.
5. Applies `infra/minikube` and waits for statefulsets, jobs, and deployments to settle.
6. Prints ingress hosts, default credentials, and cleanup instructions.

Add the suggested `/etc/hosts` line so your browser can resolve the ingress hosts:

```bash
IP=$(minikube ip)
sudo sh -c "echo \"$IP apphub.local catalog.apphub.local metastore.apphub.local filestore.apphub.local timestore.apphub.local\" >> /etc/hosts"
```

(Alternatively run `minikube tunnel` if you prefer a LoadBalancer IP.)

## Validate the deployment

```bash
npm run minikube:verify
```

Health checks cover:

- Pod readiness across the `apphub-system` namespace.
- Redis `PING` response.
- Postgres connectivity and schema availability.
- MinIO buckets (`apphub-example-bundles`, `apphub-filestore`, `apphub-timestore`).
- HTTP probes for catalog, metastore, filestore, and timestore APIs.

Pass `-- --check-ingress` to include an ingress host summary that echoes the `/etc/hosts` entry.

## Access the stack

After updating `/etc/hosts`, open:

- `http://apphub.local` – Frontend UI (served by nginx).
- `http://catalog.apphub.local/health` – Catalog API health probe.
- `http://metastore.apphub.local/readyz` – Metastore readiness probe.
- `http://filestore.apphub.local/readyz` – Filestore readiness probe.
- `http://timestore.apphub.local/ready` – Timestore readiness probe.

## Teardown

```bash
npm run minikube:down
```

Flags:

- `--purge-images` – Remove AppHub images from the minikube cache.
- `--stop-cluster` – Stop the minikube VM after deleting resources.
- `--skip-kube` – Keep the namespace (useful for manual cleanup).

## Troubleshooting

| Symptom | Suggested fix |
| --- | --- |
| `npm run minikube:up` fails to build images | Ensure Docker Desktop (or dockerd) is running, and that you have free disk space. Re-run with `--skip-start` if minikube is already running. |
| `minikube image load` errors with permission denied | Run `minikube delete` followed by `minikube start --memory=8192 --cpus=4` to reset the environment, or switch minikube to the Docker driver. |
| Pods stuck in `Pending` because of storage | Run `minikube addons enable storage-provisioner` (enabled by default) and confirm the `standard` storage class exists: `kubectl get sc`. |
| Catalog build or launch workers crash with RBAC errors | Check the `apphub-builder` / `apphub-preview` service accounts in `infra/minikube/rbac.yaml`. If you customised the namespace, reapply the overlay and re-run the bootstrap. |
| Ingress hosts return 404 | Verify `minikube addons enable ingress` succeeded and that the `/etc/hosts` entry points to `$(minikube ip)`. Re-run `npm run minikube:verify -- --check-ingress` for hints. |
| `npm run minikube:verify` fails on HTTP checks | Inspect pod logs (`kubectl logs deployment/apphub-catalog-api -n apphub-system`) and ensure environment variables are wired correctly. Re-run the bootstrap after fixing the underlying issue. |
| MinIO bucket checks fail | Delete and reapply the bootstrap job: `kubectl delete job/apphub-minio-bootstrap -n apphub-system` then `kubectl apply -k infra/minikube`. |

## Production alignment

- The same manifests can be adapted for production by swapping image tags, secrets, and ingress hosts. Use kustomize patches or Helm values to override resources and credentials.
- The turnkey script supports `--skip-build`, `--skip-load`, and `--skip-start` for CI/CD pipelines that manage those steps separately.
- Keep documentation in sync with `scripts/minikube-up.mjs` and `scripts/minikube-verify.mjs`; updates to one should be noted in the other to avoid drift.

## Maintenance notes

- When bumping runtime image tags, update `APPHUB_IMAGE_TAG` defaults or pass them to the bootstrap script.
- Review this runbook whenever Tickets 182–185 assets change to ensure instructions remain accurate.
