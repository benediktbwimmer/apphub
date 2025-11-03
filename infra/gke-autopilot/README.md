# GKE Autopilot Deployment

Use this overlay to run the full AppHub stack on a Google Kubernetes Engine Autopilot cluster. It reuses the
minikube manifests, swaps in Artifact Registry images, adds a managed ClickHouse instance with
Google Cloud Storage offload, and exposes the core and frontend services through Cloud Load Balancers.

## Prerequisites

1. Google Cloud SDK (with `gke-gcloud-auth-plugin`), `kubectl`, `docker`, and `npm`.
2. A Google Cloud project, an Autopilot cluster, and an Artifact Registry repository.
3. A GCS bucket for ClickHouse cold storage and an HMAC key pair for a service account with
   `roles/storage.objectAdmin`.

### Bootstrap helper

Run the provisioning script once per project to create (or reuse) the bucket, Artifact Registry
repository, service account, and HMAC credentials:

```bash
scripts/gke-autopilot-bootstrap.sh \
  --project <PROJECT> \
  --region europe-west1 \
  --repo apphub \
  --bucket <GCS_BUCKET> \
  --service-account apphub-clickhouse
```

The script prints the exported environment variables you can feed into the deployment helper
(`APPHUB_GKE_*`) plus the Artifact Registry prefix. Keep the generated HMAC secret safe—it is only
shown once. The helper also grants `roles/artifactregistry.reader` to the cluster's default compute
service account so Autopilot nodes can pull the published images.

## Configure the overlay

The overlay reads deployment parameters from `infra/gke-autopilot/autopilot-settings.env`:

```bash
projectId=<PROJECT>
timestoreBucket=<GCS_BUCKET>
registryPrefix=<REGISTRY_HOST>/<PROJECT>/<REPO>
imageTag=<TAG>
```

The bundled defaults are examples—edit the file directly or let the automated workflow below rewrite it.
All placeholders are referenced via Kustomize vars so the manifests pick up your project, bucket, and
image registry automatically.

## Domain & HTTPS (demo.osiris-apphub.com)

The Autopilot overlay now includes a GKE Ingress that terminates TLS for `osiris-apphub.com`,
`www.osiris-apphub.com`, and `demo.osiris-apphub.com`. Run the following once to provision the static IP,
managed DNS zone, and baseline records (adjust names if you deploy to another domain):

```bash
# Reserve a global IP that the ingress will use.
gcloud compute addresses create apphub-frontend-ip --global
gcloud compute addresses describe apphub-frontend-ip --global --format='get(address)'

# Create a Cloud DNS zone for osiris-apphub.com and capture the Google nameservers.
gcloud dns managed-zones create osiris-apphub-com \
  --dns-name=osiris-apphub.com. \
  --description="Osiris AppHub zone"
gcloud dns managed-zones describe osiris-apphub-com --format='value(nameServers)'

# Add A records pointing at the reserved IP.
gcloud dns record-sets transaction start --zone=osiris-apphub-com
gcloud dns record-sets transaction add <STATIC_IP> \
  --zone=osiris-apphub-com \
  --name=osiris-apphub.com. \
  --type=A \
  --ttl=300
gcloud dns record-sets transaction add <STATIC_IP> \
  --zone=osiris-apphub-com \
  --name=www.osiris-apphub.com. \
  --type=A \
  --ttl=300
gcloud dns record-sets transaction add <STATIC_IP> \
  --zone=osiris-apphub-com \
  --name=demo.osiris-apphub.com. \
  --type=A \
  --ttl=300
gcloud dns record-sets transaction execute --zone=osiris-apphub-com
```

Update the GoDaddy nameservers to the four values returned above. Once DNS propagates, the managed certificate
`apphub-frontend-cert` will become active and the ingress `apphub-demo-https` will serve HTTPS for:

- `osiris-apphub.com` / `www.osiris-apphub.com` → marketing site (`apphub-website`) with `/api`, `/metastore`,
  `/filestore`, and `/timestore` routed to the respective backends.
- `demo.osiris-apphub.com` → product demo UI (`apphub-frontend`) and the same API backends under matching paths.

## Automated workflow (recommended)

Run the helper to build/push images, manage secrets, update the overlay config, and apply manifests:

```bash
npm run deploy:gke-autopilot -- \
  --project <PROJECT> \
  --bucket <GCS_BUCKET> \
  --clickhouse-access-key <HMAC_ACCESS_KEY> \
  --clickhouse-secret-key <HMAC_SECRET_KEY> \
  --clickhouse-password <CLICKHOUSE_PASSWORD> \
  --frontend-api https://<CORE_LB_HOSTNAME>
```

Flags you’ll probably care about:

- `--tag <value>` – override the image tag published to Artifact Registry (`latest` by default).
- `--region <region>` – Artifact Registry region (defaults to `europe-west1`).
- `--skip-build`, `--skip-push`, `--skip-secrets`, `--skip-apply` – opt out of individual steps.
- `--kubectl-context <name>` – target a non-default context.

The script performs the following steps:

1. Rewrites `infra/gke-autopilot/autopilot-settings.env` with your project, bucket, registry, and tag.
2. Builds the five AppHub service images with `docker/Dockerfile.services`.
3. Pushes the images to Artifact Registry under `<registryPrefix>/<service>:<tag>`.
4. Creates/updates the `clickhouse-s3` and `clickhouse-auth` secrets in the target namespace.
5. Applies `kubectl apply -k infra/gke-autopilot --load-restrictor=LoadRestrictionsNone`.

## Manual deployment

Prefer to orchestrate manually? Ensure the env file is updated, then:

```bash
APPHUB_IMAGE_PREFIX=<REGISTRY_PREFIX> \
APPHUB_IMAGE_TAG=<TAG> \
VITE_API_BASE_URL=https://<CORE_LB_HOSTNAME> \
npm run docker:build:services

for svc in core metastore filestore timestore frontend; do
  docker push <REGISTRY_PREFIX>/$svc:<TAG>
done

kubectl create secret generic clickhouse-s3 \
  --namespace apphub-system \
  --from-literal=CLICKHOUSE_S3_ACCESS_KEY_ID=<HMAC_ACCESS_KEY_ID> \
  --from-literal=CLICKHOUSE_S3_SECRET_ACCESS_KEY=<HMAC_SECRET_KEY> \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic clickhouse-auth \
  --namespace apphub-system \
  --from-literal=password=<CLICKHOUSE_PASSWORD> \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -k infra/gke-autopilot --load-restrictor=LoadRestrictionsNone
```

Autopilot creates LoadBalancer services for the core API and frontend. After the rollout, obtain
the external IPs with:

```bash
kubectl get svc -n apphub-system apphub-core apphub-frontend
```

Use the `apphub-core` address for API calls and point your browser at the `apphub-frontend` address
to reach the UI. ClickHouse is available inside the cluster at the `apphub-clickhouse` service
(`8123` HTTP, `9000` native).

## Customisation notes

- The overlay still deploys Postgres, Redis, and Redpanda in-cluster while using GCS for object
  storage. Update the connection strings in `secrets.yaml` if you migrate those dependencies to
  managed services.
- `TIMESTORE_STORAGE_DRIVER=gcs` by default. Adjust the bucket or project fields in `configmap.yaml`
  if you name them differently (or update `autopilot-settings.env` and rerun the helper).
- Flink's JobManager and TaskManager now start with one replica each and rely on the `clickhouse-s3`
  secret for their GCS/HMAC credentials. Other worker-style deployments (core builds/events/
  launches/materializer, timestore ingest, etc.) remain scaled to zero by default; enable them with
  `kubectl scale deployment/<name> --replicas=N -n apphub-system` once you have quota headroom.
- Workload Identity can replace the HMAC key for ClickHouse. Annotate the timestore deployments
  with the service account email and delete the `clickhouse-s3` secret once identity federation
  is configured.
