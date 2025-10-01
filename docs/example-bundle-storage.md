# Example Bundle Durable Storage

Example bundle packaging no longer persists progress metadata or artifacts on the core pod filesystem. Status records now live in PostgreSQL and completed bundle tarballs are uploaded to an S3-compatible object store. This ensures every core replica (including minikube) can observe the same packaging state, reuse cached bundles, and serve download links without relying on pod-local disk.

## Configuration

Set the following environment variables for the core service:

| Variable | Description | Example |
| --- | --- | --- |
| `APPHUB_BUNDLE_STORAGE_BACKEND` | Storage backend: `s3` or `local`. | `s3` |
| `APPHUB_BUNDLE_STORAGE_BUCKET` | Target bucket for bundle archives. Required for `s3`. | `apphub-example-bundles` |
| `APPHUB_BUNDLE_STORAGE_ENDPOINT` | Optional S3-compatible endpoint (MinIO, etc.). | `http://127.0.0.1:9000` |
| `APPHUB_BUNDLE_STORAGE_REGION` | Region passed to the S3 client. | `us-east-1` |
| `APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE` | Set to `true` when using MinIO or custom endpoints. | `true` |
| `APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID` / `APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY` | Credentials for the object store. | `minio` / `minio123` |
| `APPHUB_BUNDLE_STORAGE_SESSION_TOKEN` | Optional session token for temporary credentials. | _(unset)_ |
| `APPHUB_BUNDLE_STORAGE_SIGNING_SECRET` | Overrides the token secret for local download URLs. | _(unset – generated)_ |
| `APPHUB_BUNDLE_STORAGE_DOWNLOAD_TTL_MS` | TTL (ms) for signed download URLs. | `300000` |

For local development the repository ships a helper script that starts a single-node MinIO instance with the expected buckets and credentials:

```bash
npm run dev:minio
```

When `APPHUB_BUNDLE_STORAGE_BACKEND=local`, artifacts are written to `services/core/data/example-bundles/artifacts`. This mode is convenient for quick smoke tests but does not satisfy multi-pod deployments.

## MinIO on Minikube

The quickest way to provide an S3-compatible endpoint locally is to run MinIO inside your existing minikube cluster:

```bash
# create a namespace for storage components
kubectl create namespace apphub-storage

# add the MinIO Helm repository and install a single-replica instance
data_dir="/data"
helm repo add minio https://charts.min.io/
helm upgrade --install apphub-minio minio/minio \
  --namespace apphub-storage \
  --set mode=standalone \
  --set rootUser=apphub \
  --set rootPassword=apphub123 \
  --set persistence.enabled=true \
  --set persistence.size=10Gi \
  --set resources.requests.memory=256Mi

# port-forward the MinIO API to localhost:9000
kubectl port-forward svc/apphub-minio -n apphub-storage 9000:9000
```

Populate the following environment variables (e.g., in `services/core/.env.local`) before starting the core API or workers:

```env
APPHUB_BUNDLE_STORAGE_BACKEND=s3
APPHUB_BUNDLE_STORAGE_BUCKET=apphub-example-bundles
APPHUB_BUNDLE_STORAGE_ENDPOINT=http://127.0.0.1:9000
APPHUB_BUNDLE_STORAGE_REGION=us-east-1
APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE=true
APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID=apphub
APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY=apphub123
# Optional overrides for job bundle publishing; falls back to the values above when unset.
# APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID=apphub
# APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY=apphub123
```

Create the bucket once the MinIO server is running:

```bash
mc alias set apphub-minio http://127.0.0.1:9000 apphub apphub123
mc mb apphub-minio/apphub-example-bundles
```

(Feel free to swap `mc` for the AWS CLI if you already have it configured.)

## Migrating Legacy Filesystem Data

Projects that previously relied on `services/core/data/example-bundles` should migrate existing statuses and artifacts into the new storage backend:

```bash
npm run migrate:example-bundles
```

The migration script reads every legacy status JSON file, uploads any discovered tarballs to the configured storage backend, and persists the converted metadata in PostgreSQL. After running the migration you can delete the legacy `status/` directory and any ad-hoc artifact folders.

The core health endpoint (`GET /health`) now emits `status: "warn"` with detailed warnings while legacy data remains on disk. This helps operators verify that migrations are complete before rolling out additional replicas.
