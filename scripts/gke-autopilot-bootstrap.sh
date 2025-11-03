#!/usr/bin/env bash
set -euo pipefail

# Provisions supporting GCP resources for AppHub's GKE Autopilot deployment.
# Creates/ensures:
#   - Artifact Registry repo (Docker)
#   - GCS bucket for ClickHouse cold storage
#   - Service account with storage.objectAdmin
#   - HMAC keypair for ClickHouse's S3 driver
#
# Usage:
#   scripts/gke-autopilot-bootstrap.sh \
#     --project my-project \
#     --region europe-west1 \
#     --repo apphub \
#     --bucket apphub-clickhouse-euw1 \
#     --service-account apphub-clickhouse

PROJECT=""
REGION=""
REPO="apphub"
BUCKET=""
SERVICE_ACCOUNT=""
SA_DISPLAY_NAME="AppHub ClickHouse Offload"

function usage() {
  cat <<EOF
Usage: scripts/gke-autopilot-bootstrap.sh [options]

Required:
  --project <id>            GCP project ID
  --region <region>         Artifact Registry + bucket region (e.g. europe-west1)
  --bucket <name>           GCS bucket name for ClickHouse cold storage
  --service-account <name>  Service account name (without @project.iam.gserviceaccount.com)

Optional:
  --repo <name>             Artifact Registry repository name (default: apphub)
  --service-account-display-name <text>
                            Service account display name (default: "AppHub ClickHouse Offload")
  -h, --help                Show this help text
EOF
}

function require_value() {
  local flag="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Error: ${flag} requires a value" >&2
    usage
    exit 1
  fi
  echo "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT=$(require_value "$1" "$2")
      shift 2
      ;;
    --region)
      REGION=$(require_value "$1" "$2")
      shift 2
      ;;
    --repo)
      REPO=$(require_value "$1" "$2")
      shift 2
      ;;
    --bucket)
      BUCKET=$(require_value "$1" "$2")
      shift 2
      ;;
    --service-account)
      SERVICE_ACCOUNT=$(require_value "$1" "$2")
      shift 2
      ;;
    --service-account-display-name)
      SA_DISPLAY_NAME=$(require_value "$1" "$2")
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT" || -z "$REGION" || -z "$BUCKET" || -z "$SERVICE_ACCOUNT" ]]; then
  echo "Error: --project, --region, --bucket, and --service-account are required." >&2
  usage
  exit 1
fi

function ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command '$1' in PATH." >&2
    exit 1
  fi
}

ensure_command gcloud
ensure_command gsutil

echo "▶ AppHub Autopilot bootstrap"
echo "   Project:          $PROJECT"
echo "   Region:           $REGION"
echo "   Artifact repo:    $REPO"
echo "   GCS bucket:       gs://$BUCKET"
echo "   Service account:  $SERVICE_ACCOUNT"

echo "→ Ensuring gcloud project is set"
gcloud config set project "$PROJECT" >/dev/null

echo "→ Resolving project number"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
if [[ -z "$PROJECT_NUMBER" ]]; then
  echo "Error: unable to resolve project number for $PROJECT" >&2
  exit 1
fi
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "→ Ensuring Artifact Registry repository"
if gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "   Repository already exists."
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="AppHub service images for GKE Autopilot" >/dev/null
  echo "   Repository created."
fi

echo "→ Ensuring GCS bucket"
if gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1; then
  echo "   Bucket already exists."
else
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" >/dev/null
  echo "   Bucket created."
fi

SA_EMAIL="${SERVICE_ACCOUNT}@${PROJECT}.iam.gserviceaccount.com"

echo "→ Ensuring service account ${SA_EMAIL}"
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  echo "   Service account already exists."
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
    --display-name "$SA_DISPLAY_NAME" >/dev/null
  echo "   Service account created."
fi

echo "→ Granting storage.objectAdmin to ${SA_EMAIL}"
if gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:serviceAccount:${SA_EMAIL} AND bindings.role:roles/storage.objectAdmin" \
  | grep -q roles/storage.objectAdmin; then
  echo "   Role already assigned."
else
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "roles/storage.objectAdmin" >/dev/null
  echo "   Role granted."
fi

echo "→ Creating HMAC credentials"
HMAC_OUTPUT=$(gsutil hmac create -p "$PROJECT" "$SA_EMAIL")
ACCESS_ID=$(echo "$HMAC_OUTPUT" | awk -F': ' '/Access ID/ {print $2}')
SECRET_KEY=$(echo "$HMAC_OUTPUT" | awk -F': ' '/Secret/ {print $2}')

if [[ -z "$ACCESS_ID" || -z "$SECRET_KEY" ]]; then
  echo "Error: failed to parse HMAC output. Raw response:" >&2
  echo "$HMAC_OUTPUT" >&2
  exit 1
fi

echo "   HMAC key created. Store the secret securely; it is only shown once."

echo "→ Granting Artifact Registry reader to ${COMPUTE_SA}"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:${COMPUTE_SA}" \
  --role "roles/artifactregistry.reader" >/dev/null
echo "   Role granted."

REGISTRY_PREFIX="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"

cat <<EOF

✅ Bootstrap complete.

Suggested exports for the deploy helper:
  export APPHUB_GKE_PROJECT=${PROJECT}
  export APPHUB_GKE_REGION=${REGION}
  export APPHUB_GKE_REPO=${REPO}
  export APPHUB_GKE_TIMESTORE_BUCKET=${BUCKET}
  export APPHUB_GKE_CLICKHOUSE_ACCESS_KEY=${ACCESS_ID}
  export APPHUB_GKE_CLICKHOUSE_SECRET_KEY=${SECRET_KEY}

Deploy command:
  npm run deploy:gke-autopilot -- --clickhouse-password <CH_PASSWORD> --frontend-api https://core.<domain>

Registry prefix:
  ${REGISTRY_PREFIX}

Remember to run:
  gcloud auth configure-docker ${REGION}-docker.pkg.dev
  gcloud container clusters get-credentials <CLUSTER_NAME> --region ${REGION} --project ${PROJECT}
EOF
