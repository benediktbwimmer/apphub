# AppHub demo on GCP

Terraform stack that replaces the AWS demo/marketing footprint with a single GCE VM (2 vCPUs, 8 GB RAM) and a Cloud CDN-backed static site bucket in `europe-west1`.

## Prerequisites
- `gcloud auth login` and `gcloud config set project <id>` already done.
- Terraform >= 1.6 and Google provider plugins (handled by `terraform init`).
- For managed DNS/certs, delegate `osiris-apphub.com` to Cloud DNS nameservers from the outputs.

## Configure
```
cd infra/gcp-demo
cp terraform.tfvars.example terraform.tfvars
```
Update:
- `project_id` (or rely on current gcloud config)
- `contact_email` for alerts/ACME
- `ssh_public_key` (public half used for SSH; `gcloud compute ssh` can also inject keys)
- optional: tokens/secrets (auto-generated if left empty), `enable_managed_dns` false if you do not delegate DNS

Defaults: region `europe-west1`, machine type `e2-standard-2` (2 vCPU/8 GB), boot disk `50` GB.

## Deploy infrastructure
```
terraform init
terraform apply
```
Outputs include:
- `cloud_dns_nameservers` to set at the registrar
- `demo_public_ip`, `demo_instance_name`, `demo_zone`
- `website_bucket`, `website_url_map_name`, `website_global_ip`

Managed TLS becomes `ACTIVE` a few minutes after DNS points at the global IP.

## Deploy marketing site
Build and sync to GCS + invalidate CDN:
```
npm run deploy:website:gcp -- --ref main
```
Use `--no-invalidate` to skip CDN cache clear.

## Redeploy demo stack code
```
npm run deploy:demo:gcp -- --ref main
```
This uses `gcloud compute ssh` to pull the branch on the VM and rebuild the compose stack.
