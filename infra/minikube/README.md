# Minikube Stack (Tickets 182 & 183)

## Quick start

Run everything (cluster start, image build, deploy) in one step:

```bash
npm run minikube:up
```

Already have the cluster running and just need fresh images + rollouts?

```bash
npm run minikube:redeploy
```

Need to remove resources later?

```bash
npm run minikube:down
```

Run smoke checks once the pods have settled:

```bash
npm run minikube:verify
```

---

This directory delivers an opinionated Kustomize overlay for spinning up AppHub and its dependencies on a local Kubernetes cluster (minikube by default). A single `kubectl apply -k infra/minikube` command provisions Postgres, Redis, MinIO, and every AppHub workload (core API + workers, metastore, filestore, timestore, and frontend) inside the `apphub-system` namespace.

## What Gets Installed

- **Stateful infrastructure**
  - *Postgres* (`StatefulSet`) with a 10Gi PVC and a bootstrap job that creates the `apphub` role, database, schemas (`metastore`, `filestore`, `timestore`), and common extensions (`uuid-ossp`, `pgcrypto`).
  - *Redis* (`StatefulSet`) with append-only files enabled and a 2Gi PVC for BullMQ state.
  - *MinIO* (single-replica `Deployment`) backed by a 5Gi PVC. A bootstrap job seeds buckets for example bundles, filestore content, and timestore partitions.
- **Shared configuration**
  - `apphub-core-config` exposes cluster-friendly defaults for service discovery (`APPHUB_*_BASE_URL`), MinIO endpoints, bundle storage, auth bypass, and Kubernetes namespace wiring for core workers.
  - `apphub-core-secrets` carries connection strings, Redis URLs, and S3 credentials referencing the in-cluster services.
- **Runtime workloads**
  - *Core API* (2 replicas) plus dedicated Deployments for ingest, build, launch, workflow, asset materializer, example bundle, event ingress, and trigger workers. Build/launch workers use service accounts (`apphub-builder`, `apphub-preview`) and enable `WORKFLOW_SCHEDULER_ADVISORY_LOCKS=1` for the scheduler.
  - *Metastore API* with `/readyz` and `/healthz` probes enabled.
  - *Filestore API* and reconciliation worker, wired to Redis queues and MinIO-backed storage.
  - *Timestore API* with ingestion, partition build, and lifecycle workers running against the MinIO-backed S3 driver.
  - *Frontend* static site served by nginx.

## Deploy

1. Start minikube (or point `kubectl` at any cluster that provides a `standard` storage class).
2. Enable the bundled NGINX ingress controller:
   ```bash
   minikube addons enable ingress
   ```
3. Apply the overlay:
   ```bash
   kubectl apply -k infra/minikube
   ```
4. Watch pods converge:
   ```bash
   kubectl get pods -n apphub-system
   ```
   All Deployments should report `AVAILABLE` and the bootstrap Jobs should complete once Postgres/MinIO are ready.

## Accessing the Stack via Ingress

The overlay publishes an ingress resource that serves:

| Host | Target service |
| --- | --- |
| `apphub.local` | Frontend (nginx, port 80) |
| `core.apphub.local` | Core API (port 4000) |
| `metastore.apphub.local` | Metastore API (port 4100) |
| `filestore.apphub.local` | Filestore API (port 4300) |
| `timestore.apphub.local` | Timestore API (port 4100) |

1. Determine the ingress controller address (falls back to the Minikube VM IP if the LoadBalancer address is still pending):
   ```bash
   INGRESS_IP=$(kubectl get svc ingress-nginx-controller -n ingress-nginx \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   if [[ -z "$INGRESS_IP" ]]; then INGRESS_IP=$(minikube ip); fi
   echo "$INGRESS_IP"
   ```
   On Docker Desktop this will usually be `127.0.0.1`; use that instead of the VM IP to avoid timeouts.
2. Add it to `/etc/hosts` so your browser and CLI can resolve the ingress hosts:
   ```bash
   sudo sh -c "echo \"$INGRESS_IP apphub.local core.apphub.local metastore.apphub.local filestore.apphub.local timestore.apphub.local\" >> /etc/hosts"
   ```
3. (Optional) If your driver does not expose LoadBalancer services automatically, run `minikube tunnel` in a separate terminal.
4. Hit the services:
   ```bash
   curl http://core.apphub.local/health
   curl http://metastore.apphub.local/readyz
   curl http://filestore.apphub.local/readyz
   curl http://timestore.apphub.local/ready
   open http://apphub.local
   ```

### Frontend API base URL

The frontend image is built with `VITE_API_BASE_URL` baked into the assets. When you rebuild the services images for minikube, point that variable at the ingress host so browser requests reach the core API:

```bash
VITE_API_BASE_URL=http://core.apphub.local APPHUB_IMAGE_TAG=dev npm run docker:build:services
```

(Adjust the tag/prefix to match your workflow.)

## Verifying Internal Services

- **Postgres**
  ```bash
  kubectl exec -n apphub-system statefulset/apphub-postgres -- \
    psql -U postgres -d apphub -c "select schema_name from information_schema.schemata where schema_name in ('metastore','filestore','timestore');"
  ```
  Port-forward for local psql clients:
  ```bash
  kubectl port-forward -n apphub-system svc/apphub-postgres 5432:5432
  ```

- **Redis**
  ```bash
  kubectl exec -n apphub-system statefulset/apphub-redis -- redis-cli ping
  ```

- **MinIO**
  ```bash
  kubectl port-forward -n apphub-system svc/apphub-minio 9000:9000 9001:9001
  kubectl exec -n apphub-system job/apphub-minio-bootstrap -- mc ls apphub
  ```

## Customisation Tips

- **Resource sizing** – Adjust CPU/memory requests or replica counts in the relevant Deployment manifests (e.g., `core/deployments.yaml`) before reapplying the overlay.
- **Credentials** – Edit `secrets.yaml` to rotate local-only passwords or MinIO keys. Ensure dependent pods are restarted after changes (`kubectl rollout restart deployment -n apphub-system <name>`).
- **Bucket/queue tweaks** – Update `minio/bootstrap-job.yaml` or the worker env vars inside the Deployment manifests when introducing new buckets or BullMQ queues.

## Cleanup

Remove everything (workloads, PVCs, secrets) by dropping the namespace:
```bash
kubectl delete namespace apphub-system
```

To rerun only the bootstrap Jobs without nuking PVC data:
```bash
kubectl delete job -n apphub-system apphub-postgres-bootstrap apphub-minio-bootstrap
```
